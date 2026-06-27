// 리팩토링 특성화 테스트용 시드 데이터.
// price/change 를 미리 박아 네트워크 없이 결정적으로 렌더되게 한다.
// NonK = nonk_*_v1, KDeal = kd_*_v1 키 (앱 코드의 키와 100% 일치해야 함).

const accounts = [
  { id: 'a1', name: '계좌1', active: true },
  { id: 'a2', name: '계좌2', active: true },
  { id: 'a3', name: '비활성', active: false },
];

// NonK(미국): 소수 단가
const nonkHoldings = [
  { ticker: 'AAPL', name: 'Apple', price: 190.5, change: 2.5, changeRate: 1.33,
    accounts: { a1: { qty: 10, avgPrice: 150.25 }, a2: { qty: 5, avgPrice: 180.0 } }, updatedAt: null },
  { ticker: 'MSFT', name: 'Microsoft', price: 410.2, change: -3.8, changeRate: -0.92,
    accounts: { a1: { qty: 4, avgPrice: 300.5 } }, updatedAt: null },
  { ticker: 'TSLA', name: 'Tesla', price: 250.0, change: 0, changeRate: 0,
    accounts: { a3: { qty: 100, avgPrice: 200.0 } }, updatedAt: null }, // 비활성 계좌만 → 합계 제외
];

// KDeal(한국): 정수 단가(원)
const kdHoldings = [
  { ticker: '005930', name: '삼성전자', price: 78000, change: 1500, changeRate: 1.96,
    accounts: { a1: { qty: 50, avgPrice: 62000 }, a2: { qty: 20, avgPrice: 71000 } }, updatedAt: null },
  { ticker: '000660', name: 'SK하이닉스', price: 185000, change: -3000, changeRate: -1.6,
    accounts: { a1: { qty: 7, avgPrice: 150000 } }, updatedAt: null },
];

const nonkCash = { a1: 1234.56, a2: 500, a3: 9999 };
const kdCash   = { a1: 3500000, a2: 1200000, a3: 9999999 };

const nonkDeposits = { transactions: [
  { id: 't1', accId: 'a1', type: 'deposit',  date: '2024-01-15', amount: 2000 },
  { id: 't2', accId: 'a2', type: 'deposit',  date: '2024-03-10', amount: 1000 },
  { id: 't3', accId: 'a1', type: 'withdraw', date: '2024-06-01', amount: 300 },
] };
const kdDeposits = { transactions: [
  { id: 't1', accId: 'a1', type: 'deposit',  date: '2024-01-15', amount: 4000000 },
  { id: 't2', accId: 'a2', type: 'deposit',  date: '2024-03-10', amount: 1500000 },
  { id: 't3', accId: 'a1', type: 'withdraw', date: '2024-06-01', amount: 500000 },
] };

// 서버 파생 스냅샷 — snapPricedAt/displayDerived(시장-키 nk/kd)가 실제로 동작하는 경로를 검증.
//  data.nk.totals.xirr ≠ data.kd.totals.xirr 로 두어 잘못된 시장 키 참조를 탐지.
//  data.prices 는 비워 둠(applyServerPrices 가 시드 가격을 덮어쓰지 않도록).
const derivedSnap = {
  dataVersion: '1',
  pricedAt: '2026-06-27T09:30:00.000Z',
  data: {
    nk: { totals: { xirr: 0.1234 }, accounts: {} },
    kd: { totals: { xirr: 0.0567 }, accounts: {} },
  },
};

export const SEEDS = {
  nonk: {
    url: 'NonK.html',
    store: {
      nonk_accounts_v1: accounts,
      nonk_holdings_v1: nonkHoldings,
      nonk_cash_v1: nonkCash,
      nonk_deposits_v1: nonkDeposits,
      nonk_monthly_v1: [],
      nonk_dividends_v1: [],
      nonk_watchlist_v1: [],
      mypm_derived_v1: derivedSnap,
      mypm_synced_version: 1,
    },
    // 캡처 대상 DOM 컨테이너 (Phase 3에서 id 비접두사화하면 후보 중 존재하는 것을 사용)
    containerIds: ['nkHoldingsContainer', 'HoldingsContainer'],
    heroIds: ['nkHeroContainer', 'HeroContainer'],
    // 인자 없이 호출 가능한 모달 오픈 함수 — 열어서 에러/내용 검증(모달 ID 회귀 탐지)
    smoke: ['OpenAddModal', 'OpenDepositModal', 'OpenRecordsModal', 'OpenDividendModal',
            'OpenAccountSettings', 'OpenWatchModal', 'tOpenTradeModal'],
  },
  kdeal: {
    url: 'KDeal.html',
    store: {
      kd_accounts_v1: accounts,
      kd_holdings_v1: kdHoldings,
      kd_cash_v1: kdCash,
      kd_deposits_v1: kdDeposits,
      kd_monthly_v1: [],
      kd_dividends_v1: [],
      kd_watchlist_v1: [],
      mypm_derived_v1: derivedSnap,
      mypm_synced_version: 1,
    },
    containerIds: ['kdHoldingsContainer', 'HoldingsContainer'],
    heroIds: ['kdHeroContainer', 'HeroContainer'],
    smoke: ['OpenAddModal', 'OpenDepositModal', 'OpenRecordsModal', 'OpenDividendModal',
            'OpenAccountSettings', 'OpenWatchModal', 'tOpenTradeModal'],
  },
};
