#!/usr/bin/env python3
"""Dependency-free fee accumulator growth monitor (#1666)."""

import argparse
import base64
import binascii
import hashlib
import json
import math
import os
import re
import struct
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_WINDOW_SECONDS = 900
DEFAULT_THRESHOLD_PCT = 25.0
DEFAULT_MIN_DELTA_STROOPS = 1000000000
DEFAULT_INTERVAL_SECONDS = 60
DEFAULT_TIMEOUT_SECONDS = 10
DEFAULT_STATE_FILE = 'monitoring-logs/fee-accumulator-samples.ndjson'
DEFAULT_CONTRACT_LABEL = 'predinex'
DEFAULT_RPC_URLS = {
    'testnet': 'https://soroban-testnet.stellar.org',
    'mainnet': 'https://soroban-mainnet.stellar.org',
}
SERVICE = 'fee-accumulator-monitor'
RUNBOOK = 'docs/FEE_ACCUMULATOR_MONITORING.md'
LOG_FIELDS = (
    'level', 'service', 'msg', 'alert', 'rule', 'severity', 'source',
    'network', 'contractLabel', 'windowSecs', 'thresholdPct',
    'baselineStroops', 'currentStroops', 'growthPct', 'runbook',
)
LABEL_RE = re.compile(r'^[A-Za-z0-9._-]{1,64}$')
NETWORK_RE = re.compile(r'^[a-z0-9][a-z0-9-]{0,31}$')
CONTRACT_RE = re.compile(r'^C[A-Z2-7]{55}$')
ADDRESS_RE = re.compile(r'^[CG][A-Z2-7]{55}$')


class ConfigError(Exception):
    pass


class SourceError(Exception):
    pass


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rpc-url', default='', help='Soroban RPC URL (env: RPC_URL)')
    parser.add_argument('--network', default='', help='Network name, testnet or mainnet (env: NETWORK)')
    parser.add_argument('--contract', default='', help='Contract ID (env: CONTRACT_ID)')
    parser.add_argument('--once', action='store_true', help='Run one check and exit')
    parser.add_argument('--interval-seconds', type=int, default=None,
                        help='Delay between checks (default: 60)')
    parser.add_argument('--timeout-seconds', type=int, default=None,
                        help='RPC timeout in seconds (default: 10)')
    parser.add_argument('--state-file', default='',
                        help='NDJSON sample file (default: monitoring-logs/fee-accumulator-samples.ndjson)')
    parser.add_argument('--contract-label', default='',
                        help='Safe label for the contract in alerts (default: predinex)')
    parser.add_argument('--window-seconds', type=int, default=None,
                        help='Growth window (default: 900)')
    parser.add_argument('--threshold-pct', type=float, default=None,
                        help='Growth percentage threshold (default: 25)')
    parser.add_argument('--min-delta-stroops', type=int, default=None,
                        help='Minimum absolute delta (default: 1000000000)')
    return parser.parse_args(argv)


def env_int(environ, name, default, minimum=1):
    raw = environ.get(name, '')
    if not isinstance(raw, str) or not raw.strip():
        return default
    try:
        value = int(raw.strip())
    except ValueError:
        return default
    return value if value >= minimum else default


def env_float(environ, name, default):
    raw = environ.get(name, '')
    if not isinstance(raw, str) or not raw.strip():
        return default
    try:
        value = float(raw.strip())
    except ValueError:
        return default
    return value if math.isfinite(value) and value > 0 else default


def safe_label(value):
    label = str(value or '').strip()
    if not LABEL_RE.fullmatch(label) or ADDRESS_RE.fullmatch(label):
        return DEFAULT_CONTRACT_LABEL
    return label


def resolve_config(args, environ):
    environ = os.environ if environ is None else environ
    network = str(args.network or environ.get('NETWORK') or 'testnet').strip().lower()
    rpc_url = str(args.rpc_url or environ.get('RPC_URL') or environ.get('STELLAR_RPC_URL')
                  or DEFAULT_RPC_URLS.get(network, '')).strip()
    contract = str(args.contract or environ.get('CONTRACT_ID') or '').strip()
    if not NETWORK_RE.fullmatch(network):
        raise ConfigError('network')
    if not rpc_url.startswith(('http://', 'https://')):
        raise ConfigError('rpc')
    if not CONTRACT_RE.fullmatch(contract):
        raise ConfigError('contract')

    window_seconds = args.window_seconds if args.window_seconds is not None else env_int(
        environ, 'FEE_GROWTH_WINDOW_SECONDS', DEFAULT_WINDOW_SECONDS)
    threshold_pct = args.threshold_pct if args.threshold_pct is not None else env_float(
        environ, 'FEE_GROWTH_THRESHOLD_PCT', DEFAULT_THRESHOLD_PCT)
    min_delta = args.min_delta_stroops if args.min_delta_stroops is not None else env_int(
        environ, 'FEE_GROWTH_MIN_DELTA_STROOPS', DEFAULT_MIN_DELTA_STROOPS, minimum=0)
    interval_seconds = args.interval_seconds if args.interval_seconds is not None else env_int(
        environ, 'FEE_GROWTH_INTERVAL_SECONDS', DEFAULT_INTERVAL_SECONDS)
    timeout_seconds = args.timeout_seconds if args.timeout_seconds is not None else env_int(
        environ, 'FEE_GROWTH_RPC_TIMEOUT_SECONDS', DEFAULT_TIMEOUT_SECONDS)
    if window_seconds < 1 or not math.isfinite(threshold_pct) or threshold_pct <= 0:
        raise ConfigError('thresholds')
    if min_delta < 0 or interval_seconds < 1 or timeout_seconds < 1:
        raise ConfigError('thresholds')

    state_file = str(args.state_file or environ.get('FEE_GROWTH_STATE_FILE')
                     or DEFAULT_STATE_FILE)
    label = safe_label(args.contract_label or environ.get('FEE_GROWTH_CONTRACT_LABEL')
                       or DEFAULT_CONTRACT_LABEL)
    return {
        'rpc_url': rpc_url,
        'network': network,
        'contract': contract,
        'window_seconds': window_seconds,
        'threshold_pct': threshold_pct,
        'min_delta_stroops': min_delta,
        'interval_seconds': interval_seconds,
        'timeout_seconds': timeout_seconds,
        'state_file': state_file,
        'contract_label': label,
        'source': 'pool_protocol_revenue',
    }


def parse_config(argv=None, environ=None):
    return resolve_config(parse_args(argv), environ)


def crc16_xmodem(data):
    crc = 0
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xffff if crc & 0x8000 else (crc << 1) & 0xffff
    return crc


def decode_contract_id(contract_id):
    padded = contract_id.upper() + '=' * ((8 - len(contract_id) % 8) % 8)
    try:
        raw = base64.b32decode(padded)
    except (binascii.Error, ValueError):
        raise SourceError('contract') from None
    if len(raw) != 35 or raw[0] != 16:
        raise SourceError('contract')
    if crc16_xmodem(raw[:33]) != struct.unpack('<H', raw[33:])[0]:
        raise SourceError('contract')
    return raw[1:33]


def u32(value):
    return struct.pack('>I', value)


def i32(value):
    return struct.pack('>i', value)


def i64(value):
    return struct.pack('>q', value)


def opaque(value):
    return u32(len(value)) + value + b'\x00' * (-len(value) % 4)


def scval_u32(value):
    return i32(3) + u32(value)


def scvec(values):
    return u32(len(values)) + b''.join(values)


def build_invoke_xdr(contract_id, function_name, args):
    parts = [
        i32(2),
        i32(0), b'\x00' * 32,
        u32(100),
        i64(1),
        i32(1),
        i64(0),
        i64(0),
        i32(0),
        u32(1),
        i32(0),
        i32(24),
        i32(0),
        i32(1), decode_contract_id(contract_id),
        opaque(function_name.encode('ascii')),
        scvec(args),
        u32(0),
        i32(0),
        i32(0),
    ]
    return base64.b64encode(b''.join(parts)).decode('ascii')


class XdrReader:
    def __init__(self, data):
        self.data = data
        self.pos = 0

    def take(self, count):
        if count < 0 or self.pos + count > len(self.data):
            raise SourceError('xdr')
        chunk = self.data[self.pos:self.pos + count]
        self.pos += count
        return chunk

    def u32(self):
        return struct.unpack('>I', self.take(4))[0]

    def i32(self):
        return struct.unpack('>i', self.take(4))[0]

    def u64(self):
        return struct.unpack('>Q', self.take(8))[0]

    def i64(self):
        return struct.unpack('>q', self.take(8))[0]

    def string(self):
        length = self.u32()
        raw = self.take(length)
        self.take(-length % 4)
        try:
            return raw.decode('utf-8')
        except UnicodeDecodeError:
            raise SourceError('xdr') from None


def read_scval(reader):
    tag = reader.i32()
    if tag == 0:
        return reader.u32() != 0
    if tag == 1:
        return None
    if tag == 3:
        return reader.u32()
    if tag == 4:
        return reader.i32()
    if tag == 5:
        return reader.u64()
    if tag == 6:
        return reader.i64()
    if tag == 9:
        return int.from_bytes(reader.take(16), 'big')
    if tag == 10:
        return int.from_bytes(reader.take(16), 'big', signed=True)
    if tag in (14, 15):
        return reader.string()
    if tag == 18:
        address_type = reader.i32()
        if address_type == 0:
            reader.i32()
        reader.take(32)
        return None
    if tag in (16, 17):
        if reader.i32() == 0:
            return [] if tag == 16 else {}
        count = reader.u32()
        if count > 10000:
            raise SourceError('xdr')
        if tag == 16:
            return [read_scval(reader) for _ in range(count)]
        result = {}
        for _ in range(count):
            key = read_scval(reader)
            value = read_scval(reader)
            if isinstance(key, str):
                result[key] = value
        return result
    raise SourceError('xdr')


def decode_scval(encoded):
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, TypeError, ValueError):
        raise SourceError('xdr') from None
    reader = XdrReader(raw)
    value = read_scval(reader)
    if reader.pos != len(raw):
        raise SourceError('xdr')
    return value


def rpc_call(config, method, params, opener=None):
    opener = opener or urllib.request.urlopen
    payload = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params},
                         separators=(',', ':')).encode('utf-8')
    request = urllib.request.Request(config['rpc_url'], data=payload,
                                     headers={'Content-Type': 'application/json'})
    try:
        response = opener(request, timeout=config['timeout_seconds'])
        try:
            body = response.read()
        finally:
            close = getattr(response, 'close', None)
            if close:
                close()
    except KeyboardInterrupt:
        raise
    except Exception:
        raise SourceError('rpc') from None
    try:
        data = json.loads(body.decode('utf-8'))
    except (AttributeError, UnicodeDecodeError, ValueError):
        raise SourceError('rpc') from None
    if not isinstance(data, dict) or data.get('error'):
        raise SourceError('rpc')
    result = data.get('result')
    if not isinstance(result, dict) or result.get('error'):
        raise SourceError('source')
    return result


def simulate_view(config, function_name, args=(), opener=None):
    transaction = build_invoke_xdr(config['contract'], function_name, args)
    result = rpc_call(config, 'simulateTransaction', {'transaction': transaction}, opener=opener)
    results = result.get('results')
    if not isinstance(results, list) or not results or not isinstance(results[0], dict):
        encoded = result.get('xdr')
        if not isinstance(encoded, str):
            raise SourceError('source')
    else:
        encoded = results[0].get('xdr')
        if not isinstance(encoded, str):
            raise SourceError('source')
    return decode_scval(encoded)


def treasury_credited(value):
    if isinstance(value, dict):
        amount = value.get('treasury_credited')
    elif isinstance(value, (list, tuple)) and len(value) >= 2:
        amount = value[1]
    else:
        amount = None
    if not isinstance(amount, int) or isinstance(amount, bool) or amount < 0:
        raise SourceError('source')
    return amount


def read_primary_stroops(config, opener=None):
    pool_count = simulate_view(config, 'get_pool_count', opener=opener)
    if not isinstance(pool_count, int) or isinstance(pool_count, bool) or pool_count < 0:
        raise SourceError('source')
    return sum(treasury_credited(simulate_view(
        config, 'get_pool_protocol_revenue', [scval_u32(pool_id)], opener=opener))
        for pool_id in range(1, pool_count + 1))


def read_current_stroops(config, opener=None):
    try:
        return read_primary_stroops(config, opener=opener), 'pool_protocol_revenue'
    except SourceError:
        balance = simulate_view(config, 'get_treasury_balance', opener=opener)
        if not isinstance(balance, int) or isinstance(balance, bool) or balance < 0:
            raise SourceError('source')
        return balance, 'treasury_balance'


def state_key(network, contract):
    digest = hashlib.sha256((network + '|' + contract).encode('utf-8')).hexdigest()[:16]
    return network + ':' + digest


def read_state(path, key, now, window_seconds):
    try:
        lines = Path(path).read_text(encoding='utf-8').splitlines()
    except FileNotFoundError:
        return [], []
    records = []
    samples = []
    for line in lines:
        try:
            record = json.loads(line)
        except ValueError:
            continue
        if not isinstance(record, dict) or record.get('type') != 'sample':
            continue
        timestamp = record.get('ts')
        if not isinstance(timestamp, (int, float)) or isinstance(timestamp, bool):
            continue
        if now - timestamp >= window_seconds:
            continue
        records.append(record)
        if record.get('key') != key or not isinstance(record.get('stroops'), int):
            continue
        samples.append((float(timestamp), record['stroops'], bool(record.get('breach'))))
    samples.sort(key=lambda sample: sample[0])
    return records, samples


def write_state(path, records):
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open('w', encoding='utf-8') as stream:
        for record in records:
            stream.write(json.dumps(record, sort_keys=True, separators=(',', ':')) + '\n')


def evaluate(samples, current, config, now):
    baseline = samples[0][1] if samples else current
    delta = current - baseline
    limit = max(baseline * config['threshold_pct'] / 100.0, config['min_delta_stroops'])
    breach = delta > limit
    last_breach = max((sample[0] for sample in samples if sample[2]), default=None)
    active = last_breach is not None and now - last_breach < config['window_seconds']
    if baseline > 0:
        growth_pct = round(delta * 100.0 / baseline, 2)
    else:
        growth_pct = 100.0 if current > 0 else 0.0
    return {
        'baseline': baseline,
        'current': current,
        'delta': delta,
        'limit': limit,
        'breach': breach,
        'alert': breach and not active,
        'growthPct': growth_pct,
    }


def emit_alert(decision, config):
    record = {
        'level': 'error',
        'service': SERVICE,
        'msg': 'fee_accumulator_growth_alert',
        'alert': 'fee_accumulator_growth',
        'rule': 'delta_exceeds_max_of_threshold_pct_and_min_delta',
        'severity': 'SEV-3',
        'source': config['source'],
        'network': config['network'],
        'contractLabel': config['contract_label'],
        'windowSecs': config['window_seconds'],
        'thresholdPct': config['threshold_pct'],
        'baselineStroops': decision['baseline'],
        'currentStroops': decision['current'],
        'growthPct': decision['growthPct'],
        'runbook': RUNBOOK,
    }
    print(json.dumps(record, sort_keys=True, separators=(',', ':')))


def monitor(config, once=False, clock=None, sleep=None, opener=None, emit=None):
    clock = clock or time.time
    sleep = sleep or time.sleep
    emit = emit or emit_alert
    key = state_key(config['network'], config['contract'])
    try:
        while True:
            now = clock()
            current, source = read_current_stroops(config, opener=opener)
            run_config = dict(config, source=source)
            records, samples = read_state(config['state_file'], key, now,
                                          config['window_seconds'])
            decision = evaluate(samples, current, run_config, now)
            if decision['alert']:
                emit(decision, run_config)
            records.append({
                'type': 'sample',
                'key': key,
                'network': config['network'],
                'contractLabel': config['contract_label'],
                'ts': now,
                'stroops': current,
                'source': source,
                'breach': decision['breach'],
            })
            write_state(config['state_file'], records)
            if once:
                return 0
            sleep(config['interval_seconds'])
    except KeyboardInterrupt:
        return 0
    except Exception:
        print('::error::Fee accumulator monitor stopped: configuration or source error.',
              file=sys.stderr)
        return 1


def main(argv=None, environ=None):
    args = parse_args(argv)
    try:
        config = resolve_config(args, environ)
    except ConfigError:
        print('::error::Invalid fee accumulator monitor configuration.', file=sys.stderr)
        return 2
    return monitor(config, once=args.once)


if __name__ == '__main__':
    sys.exit(main())
