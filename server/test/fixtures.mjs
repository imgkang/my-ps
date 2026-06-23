// 인출 시뮬레이션 테스트/벤치 공용 픽스처 및 입력→ctx 변환기.
const WIFE = ['wife_dc', 'wife_pension1', 'wife_pension2', 'wife_irp', 'wife_isa'];
const DC = ['dc', 'wife_dc'];
const RATES = { u70: 0.055, m7080: 0.044, o80: 0.033 };
const yearsFrom = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const acc = (anse, dcPrincipal, regular) => ({ anse, dcPrincipal, regular, total: anse + dcPrincipal + regular });

function baseScalars(myBY) {
  return {
    todayYear: 2026, npCurrentYear: 2026,
    r: 0.04, inf: 0.022, epTR: 0.165, npTR: 0.04,
    myRTR_base: 0.12, myB10: 0.7, myB20: 0.6, myB30: 0.5,
    pensionTaxRates: RATES, maxYear: myBY > 0 ? myBY + 95 : 2100,
    wifeBaseAccIds: WIFE, dcAccIds: DC, myExtraIds: [],
  };
}

const fixtureA = () => {
  const myBY = 1970, startYear = 2030;
  const allAccIds = ['dc', 'pension1', 'pension2', 'irp', 'isa'];
  return { name: 'A 단독/고정가치', input: {
    ...baseScalars(myBY), years: yearsFrom(startYear, myBY + 95), startYear, myBY, wifeBY: 0, hasWife: false, basicWithdraw: 0,
    periods: [{ startYear, type: 'fixed', totalAmount: 60, myAmount: 60, wifeAmount: 0, wifeContrib: 'fixed', wifeRatio: 50, pct: 4, publicPensionMode: 'include' }],
    allAccIds, myWithdrawIds: allAccIds, activeWifeIds: [], wifeExtraIds: [],
    initState: { dc: acc(0, 100e6, 0), pension1: acc(30e6, 0, 70e6), pension2: acc(0, 0, 50e6), irp: acc(0, 0, 0), isa: acc(0, 0, 0) },
    depositPlan: {},
    myPension: { np: { use: true, startYear: 2035, startMonth: 1, monthlyManwon: 100 } }, wifePension: {},
  } };
};

const fixtureB = () => {
  const myBY = 1972, wifeBY = 1975, startYear = 2032;
  const allAccIds = ['dc', 'pension1', 'pension2', 'irp', 'isa', ...WIFE];
  return { name: 'B 배우자/비율기여', input: {
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
  } };
};

const fixtureC = () => {
  const myBY = 1980, startYear = 2028;
  const allAccIds = ['dc', 'pension1', 'pension2', 'irp', 'isa'];
  return { name: 'C 인출율+적립', input: {
    ...baseScalars(myBY), years: yearsFrom(startYear, myBY + 95), startYear, myBY, wifeBY: 0, hasWife: false, basicWithdraw: 0,
    periods: [{ startYear, type: 'pct', totalAmount: 0, myAmount: 0, wifeAmount: 0, wifeContrib: 'fixed', wifeRatio: 50, pct: 4.5, publicPensionMode: 'add' }],
    allAccIds, myWithdrawIds: allAccIds, activeWifeIds: [], wifeExtraIds: [],
    initState: { dc: acc(0, 60e6, 0), pension1: acc(40e6, 0, 80e6), pension2: acc(0, 0, 0), irp: acc(0, 0, 20e6), isa: acc(0, 0, 0) },
    depositPlan: { pension1: { 2028: { depositWon: 6e6, totalSimpleMw: 50, anseSimpleMw: 50 }, 2029: { depositWon: 6e6, totalSimpleMw: 50, anseSimpleMw: 20 } } },
    myPension: { np: { use: true, startYear: 2045, startMonth: 1, monthlyManwon: 110, delayYears: 2 } }, wifePension: {},
  } };
};

const fixtureD = () => {
  const myBY = 1968, wifeBY = 1970, startYear = 2027;
  const allAccIds = ['dc', 'pension1', 'pension2', 'irp', 'isa', ...WIFE];
  return { name: 'D 다구간/topup', input: {
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
  } };
};

export const fixtures = [fixtureA(), fixtureB(), fixtureC(), fixtureD()];

// 원본 루프(legacyLoop)용 ctx 로 변환 (전역/헬퍼 주입).
export function inputToCtx(input) {
  const PTR = input.pensionTaxRates;
  const getPTR = (by, yr) => {
    if (!by) return PTR.o80;
    const a = yr - by;
    if (a < 70) return PTR.u70;
    if (a < 80) return PTR.m7080;
    return PTR.o80;
  };
  const dep = (id, yr) => input.depositPlan[id]?.[yr];
  return {
    years: input.years, allAccIds: input.allAccIds, startYear: input.startYear,
    state: Object.fromEntries(input.allAccIds.map((id) => [id, { ...input.initState[id] }])),
    initState: input.initState,
    r: input.r, inf: input.inf, epTR: input.epTR, npTR: input.npTR, todayYear: input.todayYear,
    myBY: input.myBY, wifeBY: input.wifeBY,
    myRTR_base: input.myRTR_base, myB10: input.myB10, myB20: input.myB20, myB30: input.myB30,
    myWithdrawIds: input.myWithdrawIds,
    wifeExtraSet: new Set(input.wifeExtraIds), wifeExtraIds: input.wifeExtraIds, myExtraIds: input.myExtraIds || [],
    getPTR, getActiveWifeAccIds: () => input.activeWifeIds,
    appSettings: { hasWife: input.hasWife, myBirthYear: input.myBY },
    wp: { basicWithdraw: input.basicWithdraw, periods: input.periods, myBirthYear: input.myBY },
    myPersonCfg: input.myPension, wifePersonCfg: input.wifePension,
    getMonthlyPlanYearEndValueWon: (id, yr) => dep(id, yr)?.depositWon || 0,
    getMonthlyPlanIncrManwon: (id, yr) => dep(id, yr)?.totalSimpleMw || 0,
    getMonthlyPlanAnseIncrManwon: (id, yr) => dep(id, yr)?.anseSimpleMw || 0,
    WIFE_ACC_IDS: input.wifeBaseAccIds, DC_ACC_IDS: new Set(input.dcAccIds),
    PENSION_THRESHOLD: 15_000_000, _wdLog: () => {},
  };
}
