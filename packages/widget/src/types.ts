export interface WidgetPool {
  id: number;
  title: string;
  description: string;
  outcomeA: string;
  outcomeB: string;
  totalA: number;
  totalB: number;
  settled: boolean;
  winningOutcome?: number;
  expiry: number;
  status: 'open' | 'settled' | 'frozen' | 'disputed';
}

export interface WidgetTheme {
  /** CSS color value for primary accent. Default: #6366f1 */
  primaryColor?: string;
  /** 'light' | 'dark'. Default: 'light' */
  mode?: 'light' | 'dark';
  /** Border radius in px. Default: 16 */
  borderRadius?: number;
  /** Font family. Default: system-ui */
  fontFamily?: string;
}

export interface PredinexWidgetProps {
  /** Soroban contract ID for the Predinex contract */
  contractId: string;
  /** Pool ID to display. Omit to show a list. */
  poolId?: number;
  /** Override theme tokens */
  theme?: WidgetTheme;
  /** Called when the user successfully places a bet */
  onBet?: (poolId: number, outcome: number, amount: number) => void;
  /** Inject a custom data fetcher (useful for SSR / testing) */
  fetchPool?: (contractId: string, poolId: number) => Promise<WidgetPool>;
  /** Inject a custom bet submitter */
  placeBet?: (
    contractId: string,
    poolId: number,
    outcome: number,
    amount: number
  ) => Promise<string>;
}
