// 벤치용 인출 시뮬레이션 입력 픽스처 (서버 계산시간 측정용).
// server/test/fixtures.mjs 와 동일한 시나리오를 TS 로 둔다(컴파일 포함).
import type { WithdrawalInput } from '../compute/withdrawal.js';

const WIFE = ['wife_dc', 'wife_pension1', 'wife_pension2', 'wife_irp', 'wife_isa'];
const DC = ['dc', 'wife_dc'];
const RATES = { u70: 0.055, m7080: 0.044, o80: 0.033 };
const yearsFrom = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const acc = (anse: number, dcPrincipal: number, regular: number) => ({ anse, dcPrincipal, regular, total: anse + dcPrincipal + regular });

const baseScalars = (myBY: number) => ({
  todayYear: 2026, npCurrentYear: 2026,
  r: 0.04, inf: 0.022, epTR: 0.165, npTR: 0.04,
  myRTR_base: 0.12, myB10: 0.7, myB20: 0.6, myB30: 0.5,
  pensionTaxRates: RATES, maxYear: myBY > 0 ? myBY + 95 : 2100,
  wifeBaseAccIds: WIFE, dcAccIds: DC,
});

export const benchInputs: WithdrawalInput[] = [
  // A: 단독/고정가치
  (() => {
    const myBY = 1970, startYear = 2030;
    const allAccIds = ['dc', 'pension1', 'pension2', 'irp', 'isa'];
    return {
      ...baseScalars(myBY), years: yearsFrom(startYear, myBY + 95), startYear, myBY, wifeBY: 0, hasWife: false, basicWithdraw: 0,
      periods: [{ startYear, type: 'fixed', totalAmount: 60, myAmount: 60, wifeAmount: 0, wifeContrib: 'fixed', wifeRatio: 50, pct: 4, publicPensionMode: 'include' }],
      allAccIds, myWithdrawIds: allAccIds, activeWifeIds: [], wifeExtraIds: [],
      initState: { dc: acc(0, 100e6, 0), pension1: acc(30e6, 0, 70e6), pension2: acc(0, 0, 50e6), irp: acc(0, 0, 0), isa: acc(0, 0, 0) },
      depositPlan: {}, myPension: { np: { use: true, startYear: 2035, startMonth: 1, monthlyManwon: 100 } }, wifePension: {},
    } as WithdrawalInput;
  })(),
  // B: 배우자/비율기여
  (() => {
    const myBY = 1972, wifeBY = 1975, startYear = 2032;
    const allAccIds = ['dc', 'pension1', 'pension2', 'irp', 'isa', ...WIFE];
    return {
      ...baseScalars(myBY), years: yearsFrom(startYear, myBY + 95), startYear, myBY, wifeBY, hasWife: true, basicWithdraw: 10,
      periods: [{ startYear, type: 'fixed', totalAmount: 80, myAmount: 40, wifeAmount: 40, wifeContrib: 'ratio', wifeRatio: 40, pct: 4, publicPensionMode: 'include' }],
      allAccIds, myWithdrawIds: ['dc', 'pension1', 'pension2', 'irp', 'isa'], activeWifeIds: WIFE, wifeExtraIds: [],
      initState: {
        dc: acc(0, 120e6, 0), pension1: acc(50e6, 0, 60e6), pension2: acc(0, 0, 40e6), irp: acc(20e6, 0, 10e6), isa: acc(0, 0, 30e6),
        wife_dc: acc(0, 80e6, 0), wife_pension1: acc(20e6, 0, 30e6), wife_pension2: acc(0, 0, 20e6), wife_irp: acc(0, 0, 0), wife_isa: acc(0, 0, 0),
      },
      depositPlan: {},
      myPension: { np: { use: true, startYear: 2037, startMonth: 3, monthlyManwon: 120 }, gp: { use: true, startYear: 2034, startMonth: 1, monthlyManwon: 50 } },
      wifePension: { np: { use: true, startYear: 2040, startMonth: 1, monthlyManwon: 90 } },
    } as WithdrawalInput;
  })(),
  // C: 인출율+적립
  (() => {
    const myBY = 1980, startYear = 2028;
    const allAccIds = ['dc', 'pension1', 'pension2', 'irp', 'isa'];
    return {
      ...baseScalars(myBY), years: yearsFrom(startYear, myBY + 95), startYear, myBY, wifeBY: 0, hasWife: false, basicWithdraw: 0,
      periods: [{ startYear, type: 'pct', totalAmount: 0, myAmount: 0, wifeAmount: 0, wifeContrib: 'fixed', wifeRatio: 50, pct: 4.5, publicPensionMode: 'add' }],
      allAccIds, myWithdrawIds: allAccIds, activeWifeIds: [], wifeExtraIds: [],
      initState: { dc: acc(0, 60e6, 0), pension1: acc(40e6, 0, 80e6), pension2: acc(0, 0, 0), irp: acc(0, 0, 20e6), isa: acc(0, 0, 0) },
      depositPlan: { pension1: { '2028': { depositWon: 6e6, totalSimpleMw: 50, anseSimpleMw: 50 }, '2029': { depositWon: 6e6, totalSimpleMw: 50, anseSimpleMw: 20 } } },
      myPension: { np: { use: true, startYear: 2045, startMonth: 1, monthlyManwon: 110, delayYears: 2 } }, wifePension: {},
    } as WithdrawalInput;
  })(),
  // D: 다구간/topup
  (() => {
    const myBY = 1968, wifeBY = 1970, startYear = 2027;
    const allAccIds = ['dc', 'pension1', 'pension2', 'irp', 'isa', ...WIFE];
    return {
      ...baseScalars(myBY), years: yearsFrom(startYear, myBY + 95), startYear, myBY, wifeBY, hasWife: true, basicWithdraw: 5,
      periods: [
        { startYear, type: 'nominal', totalAmount: 100, myAmount: 60, wifeAmount: 40, wifeContrib: 'fixed', wifeRatio: 50, pct: 4, publicPensionMode: 'include' },
        { startYear: startYear + 8, type: 'fixed', totalAmount: 70, myAmount: 50, wifeAmount: 20, wifeContrib: 'topup', wifeRatio: 50, pct: 4, publicPensionMode: 'add' },
      ],
      allAccIds, myWithdrawIds: ['dc', 'pension1', 'pension2', 'irp', 'isa'], activeWifeIds: WIFE, wifeExtraIds: [],
      initState: {
        dc: acc(0, 50e6, 0), pension1: acc(60e6, 0, 40e6), pension2: acc(0, 0, 30e6), irp: acc(0, 0, 0), isa: acc(0, 0, 0),
        wife_dc: acc(0, 30e6, 0), wife_pension1: acc(15e6, 0, 25e6), wife_pension2: acc(0, 0, 0), wife_irp: acc(0, 0, 0), wife_isa: acc(0, 0, 0),
      },
      depositPlan: {},
      myPension: { np: { use: true, startYear: 2033, startMonth: 6, monthlyManwon: 130 }, sp: { use: true, startYear: 2030, startMonth: 1, monthlyManwon: 40, delayYears: 1 } },
      wifePension: { np: { use: true, startYear: 2035, startMonth: 1, monthlyManwon: 80 } },
    } as WithdrawalInput;
  })(),
];

// 클라이언트가 인출 렌더 시 동기로 하는 작업(적립 스케줄 사전계산 + 직렬화) 재현.
export function clientAssembleCost(input: WithdrawalInput): number {
  const depositPlan: Record<string, Record<string, unknown>> = {};
  for (const accId of input.allAccIds) {
    for (const yr of input.years) {
      const dp = input.depositPlan[accId]?.[String(yr)];
      const depositWon = dp?.depositWon || 0;
      if (depositWon <= 0) continue;
      (depositPlan[accId] || (depositPlan[accId] = {}))[yr] = {
        depositWon, totalSimpleMw: dp!.totalSimpleMw, anseSimpleMw: dp!.anseSimpleMw,
      };
    }
  }
  return JSON.stringify({ ...input, depositPlan }).length;
}
