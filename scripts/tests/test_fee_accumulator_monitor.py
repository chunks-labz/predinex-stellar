"""Regression tests for the fee accumulator growth monitor (#1666)."""

import base64
import importlib.util
import io
import json
import os
import struct
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path
from types import SimpleNamespace

SCRIPTS_DIR = Path(__file__).resolve().parents[1]

spec = importlib.util.spec_from_file_location(
    'check_fee_accumulator_growth', SCRIPTS_DIR / 'check-fee-accumulator-growth.py')
monitor_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor_mod)

CONTRACT = 'CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR'
OTHER_CONTRACT = 'CAEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQTD2L'
SYMBOL_OFFSET = 128


def scval_u32(value):
    return base64.b64encode(struct.pack('>II', 3, value)).decode()


def i128_bytes(value):
    return struct.pack('>i', 10) + value.to_bytes(16, 'big', signed=True)


def scval_i128(value):
    return base64.b64encode(i128_bytes(value)).decode()


def scval_map(fields):
    parts = [struct.pack('>iiI', 17, 1, len(fields))]
    for key, value in fields:
        raw = key.encode()
        parts.append(struct.pack('>iI', 15, len(raw)) + raw + b'\x00' * (-len(raw) % 4))
        parts.append(i128_bytes(value))
    return base64.b64encode(b''.join(parts)).decode()


def revenue_map(value):
    return scval_map([('settlement_protocol_fee', 1), ('treasury_credited', value)])


def view_from_request(request):
    body = json.loads(request.data)
    xdr = base64.b64decode(body['params']['transaction'])
    length = struct.unpack('>I', xdr[SYMBOL_OFFSET:SYMBOL_OFFSET + 4])[0]
    name = xdr[SYMBOL_OFFSET + 4:SYMBOL_OFFSET + 4 + length].decode()
    position = SYMBOL_OFFSET + 4 + length + (-length % 4)
    count = struct.unpack('>I', xdr[position:position + 4])[0]
    position += 4
    args = []
    for _ in range(count):
        tag = struct.unpack('>i', xdr[position:position + 4])[0]
        if tag != 3:
            raise AssertionError('unexpected argument tag')
        args.append(struct.unpack('>I', xdr[position + 4:position + 8])[0])
        position += 8
    return name, args


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode()

    def read(self):
        return self.payload

    def close(self):
        pass


class FakeRpc:
    def __init__(self, views, fail=()):
        self.views = views
        self.fail = set(fail)
        self.calls = []

    def __call__(self, request, timeout=None):
        name, args = view_from_request(request)
        self.calls.append((name, tuple(args)))
        if name in self.fail:
            return FakeResponse({'jsonrpc': '2.0', 'error': {
                'code': -32603, 'message': 'SECRET raw error XDR tx_hash'}})
        value = self.views[name]
        if callable(value):
            encoded = value(args)
        else:
            encoded = value
        return FakeResponse({'jsonrpc': '2.0', 'result': {
            'results': [{'xdr': encoded}], 'latestLedger': 100}})


def revenue_views(count, amounts):
    return {
        'get_pool_count': scval_u32(count),
        'get_pool_protocol_revenue': lambda args: revenue_map(amounts[args[0] - 1]),
    }


class FeeAccumulatorMonitorTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.state_file = str(Path(directory.name) / 'samples.ndjson')
        self.now = 1700000000.0
        self.sleeps = []
        self.alerts = []
        self.env = {
            'CONTRACT_ID': CONTRACT,
            'NETWORK': 'testnet',
            'RPC_URL': 'https://rpc.example',
            'FEE_GROWTH_STATE_FILE': self.state_file,
        }

    def run_check(self, views, fail=(), environ=None, once=True, now=None):
        config = monitor_mod.parse_config([], dict(self.env, **(environ or {})))
        rpc = FakeRpc(views, fail)
        clock = (lambda: self.now) if now is None else (lambda: now)
        code = monitor_mod.monitor(config, once=once, clock=clock,
                                   sleep=self.sleeps.append, opener=rpc,
                                   emit=lambda decision, conf: self.alerts.append((decision, conf)))
        return code, rpc

    def samples(self):
        path = Path(self.state_file)
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text().splitlines() if line]

    def test_invoke_xdr_encodes_view_name_and_pool_id(self):
        xdr = base64.b64decode(monitor_mod.build_invoke_xdr(CONTRACT, 'get_pool_protocol_revenue',
                                                           [monitor_mod.scval_u32(7)]))
        self.assertEqual(struct.unpack('>I', xdr[0:4])[0], 2)
        request = SimpleNamespace(data=json.dumps({
            'params': {'transaction': base64.b64encode(xdr).decode()}}).encode())
        name, args = view_from_request(request)
        self.assertEqual((name, args), ('get_pool_protocol_revenue', [7]))

    def test_below_threshold_records_sample_without_alert(self):
        self.run_check(revenue_views(1, [10000000000]))
        self.now += 60
        code, rpc = self.run_check(revenue_views(1, [12000000000]))
        self.assertEqual(code, 0)
        self.assertEqual(self.alerts, [])
        self.assertEqual(len(self.samples()), 2)
        self.assertEqual(len([call for call in rpc.calls if call[0] == 'get_pool_protocol_revenue']), 1)

    def test_above_threshold_alerts_once_per_incident(self):
        self.run_check(revenue_views(1, [10000000000]))
        self.now += 60
        self.run_check(revenue_views(1, [14000000000]))
        self.now += 60
        code, _ = self.run_check(revenue_views(1, [15000000000]))
        self.assertEqual(code, 0)
        self.assertEqual(len(self.alerts), 1)
        decision, config = self.alerts[0]
        self.assertEqual((decision['baseline'], decision['current']), (10000000000, 14000000000))
        self.assertEqual(decision['growthPct'], 40.0)
        self.assertEqual(config['source'], 'pool_protocol_revenue')

    def test_exact_window_boundary_is_pruned(self):
        self.run_check(revenue_views(1, [10000000000]))
        self.now += 900
        self.run_check(revenue_views(1, [10000000000]))
        self.assertEqual([sample['ts'] for sample in self.samples()], [self.now])

    def test_rearm_requires_full_window_without_a_breach(self):
        self.run_check(revenue_views(1, [10000000000]))
        self.now += 60
        self.run_check(revenue_views(1, [14000000000]))
        self.now += 300
        self.run_check(revenue_views(1, [15000000000]))
        self.assertEqual(len(self.alerts), 1)
        self.now += 901
        self.run_check(revenue_views(1, [10000000000]))
        self.now += 60
        code, _ = self.run_check(revenue_views(1, [14000000000]))
        self.assertEqual(code, 0)
        self.assertEqual(len(self.alerts), 2)

    def test_primary_accumulator_is_monotonic_and_fallback_net_balance_drops_on_withdrawal(self):
        self.run_check(revenue_views(2, [5000000000, 5000000000]))
        self.now += 60
        code, rpc = self.run_check(revenue_views(2, [7000000000, 7000000000]))
        self.assertEqual(code, 0)
        self.assertEqual(len(self.alerts), 1)
        self.assertEqual([call[1] for call in rpc.calls if call[0] == 'get_pool_protocol_revenue'],
                         [(1,), (2,)])

        self.setUp()
        fallback = {'get_treasury_balance': lambda args: scval_i128(10000000000)}
        self.run_check(fallback)
        self.now += 60
        self.run_check({'get_treasury_balance': lambda args: scval_i128(8000000000)})
        self.assertEqual(self.alerts, [])
        self.assertEqual({sample['source'] for sample in self.samples()}, {'treasury_balance'})

    def test_fallback_uses_treasury_balance_when_primary_view_fails(self):
        views = {'get_treasury_balance': lambda args: scval_i128(12000000000)}
        code, rpc = self.run_check(views, fail=('get_pool_count',))
        self.assertEqual(code, 0)
        self.assertEqual(self.samples()[0]['source'], 'treasury_balance')
        self.assertNotIn('get_pool_protocol_revenue', [call[0] for call in rpc.calls])

    def test_invalid_env_values_fall_back_to_safe_defaults(self):
        environ = {
            'FEE_GROWTH_WINDOW_SECONDS': 'not-a-number',
            'FEE_GROWTH_THRESHOLD_PCT': '-5',
            'FEE_GROWTH_MIN_DELTA_STROOPS': 'NaN',
            'FEE_GROWTH_INTERVAL_SECONDS': '0',
            'FEE_GROWTH_CONTRACT_LABEL': CONTRACT,
        }
        config = monitor_mod.parse_config([], dict(self.env, **environ))
        self.assertEqual(config['window_seconds'], monitor_mod.DEFAULT_WINDOW_SECONDS)
        self.assertEqual(config['threshold_pct'], monitor_mod.DEFAULT_THRESHOLD_PCT)
        self.assertEqual(config['min_delta_stroops'], monitor_mod.DEFAULT_MIN_DELTA_STROOPS)
        self.assertEqual(config['interval_seconds'], monitor_mod.DEFAULT_INTERVAL_SECONDS)
        self.assertEqual(config['contract_label'], 'predinex')

    def test_alert_log_is_allowlisted_and_redacted(self):
        self.env['CONTRACT_ID'] = OTHER_CONTRACT
        self.env['FEE_GROWTH_CONTRACT_LABEL'] = 'prod-mainnet'
        fallback = {'get_treasury_balance': lambda args: scval_i128(10000000000)}
        self.run_check(fallback)
        self.now += 60
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = monitor_mod.monitor(
                monitor_mod.parse_config([], self.env), once=True, clock=lambda: self.now,
                sleep=self.sleeps.append,
                opener=FakeRpc({'get_treasury_balance': lambda args: scval_i128(13000000000)},
                               fail=('get_pool_count',)),
                emit=monitor_mod.emit_alert)
        self.assertEqual(code, 0)
        record = json.loads(out.getvalue())
        self.assertEqual(set(record), set(monitor_mod.LOG_FIELDS))
        self.assertEqual(record['contractLabel'], 'prod-mainnet')
        self.assertEqual(record['source'], 'treasury_balance')
        combined = out.getvalue() + err.getvalue()
        for forbidden in (OTHER_CONTRACT, CONTRACT, 'SECRET', 'XDR', 'tx_hash', 'raw error'):
            self.assertNotIn(forbidden, combined)

    def test_only_allowlisted_field_names_are_emitted(self):
        self.assertEqual(len(monitor_mod.LOG_FIELDS), len(set(monitor_mod.LOG_FIELDS)))
        self.assertEqual(monitor_mod.LOG_FIELDS, (
            'level', 'service', 'msg', 'alert', 'rule', 'severity', 'source',
            'network', 'contractLabel', 'windowSecs', 'thresholdPct',
            'baselineStroops', 'currentStroops', 'growthPct', 'runbook'))

    def test_min_delta_floor_uses_strict_inequality(self):
        self.run_check(revenue_views(1, [1000]))
        self.now += 60
        self.run_check(revenue_views(1, [1000 + monitor_mod.DEFAULT_MIN_DELTA_STROOPS]))
        self.assertEqual(self.alerts, [])
        self.now += 60
        code, _ = self.run_check(revenue_views(1, [1001 + monitor_mod.DEFAULT_MIN_DELTA_STROOPS]))
        self.assertEqual(code, 0)
        self.assertEqual(len(self.alerts), 1)

    def test_source_and_config_failures_exit_nonzero(self):
        err = io.StringIO()
        with redirect_stderr(err):
            code, _ = self.run_check(revenue_views(1, [10000000000]),
                                     fail=('get_pool_count', 'get_treasury_balance'))
        self.assertEqual(code, 1)
        err = io.StringIO()
        with redirect_stderr(err):
            config_code = monitor_mod.main(['--rpc-url', 'ftp://rpc.example'], self.env)
        self.assertEqual(config_code, 2)
        self.assertNotIn('ftp://', err.getvalue())

    def test_once_skips_sleep_and_loop_can_be_interrupted(self):
        self.run_check(revenue_views(1, [10000000000]))
        self.assertEqual(self.sleeps, [])
        config = monitor_mod.parse_config([], self.env)
        self.now += 60
        code = monitor_mod.monitor(config, once=False, clock=lambda: self.now,
                                   sleep=lambda seconds: (_ for _ in ()).throw(KeyboardInterrupt),
                                   opener=FakeRpc(revenue_views(1, [11000000000])),
                                   emit=lambda decision, conf: self.alerts.append((decision, conf)))
        self.assertEqual(code, 0)
        self.assertEqual(len(self.alerts), 0)


if __name__ == '__main__':
    unittest.main()
