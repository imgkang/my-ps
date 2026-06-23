// AUTO-GENERATED from `git show HEAD:index.html` by gen-legacy.mjs — do not edit.
// 원본 인출 투영 루프(검증 골든). ctx 로 전역/헬퍼를 주입받아 실행한다.
export function legacyLoop(ctx) {
  const {
    years, allAccIds, startYear, state, initState,
    r, inf, epTR, npTR, todayYear, myBY, wifeBY,
    myRTR_base, myB10, myB20, myB30, myWithdrawIds, wifeExtraSet, wifeExtraIds,
    myExtraIds, getPTR, getActiveWifeAccIds, appSettings, wp,
    myPersonCfg, wifePersonCfg,
    getMonthlyPlanYearEndValueWon, getMonthlyPlanIncrManwon, getMonthlyPlanAnseIncrManwon,
    WIFE_ACC_IDS, DC_ACC_IDS, PENSION_THRESHOLD, _wdLog,
  } = ctx;
  const withdrawals = {}, balances = {}, summary = {};

  // 끝연도 자동 파생 (구간i+1의 시작-1, 마지막은 본인 95세)
  const _myBY = wp.myBirthYear || appSettings.myBirthYear || 0;
  const _maxYear = _myBY > 0 ? _myBY + 95 : 2100;
  const _sortedP = [...(wp.periods||[])].sort((a,b)=>a.startYear-b.startYear);
  const periodsWithEnd = _sortedP.map((p,i)=>({
    ...p,
    derivedEndYear: i < _sortedP.length-1 ? _sortedP[i+1].startYear-1 : _maxYear
  }));

  for (const yr of years) {
    withdrawals[yr] = {};
    for (const accId of allAccIds) withdrawals[yr][accId] = { anseOut: 0, dcOut: 0, regularOut: 0, pensionTax: 0 };

    // 인출 시작 전 구간: 수익률 미적용, 빈 잔액 기록 후 skip
    if (yr < startYear) {
      for (const accId of allAccIds) withdrawals[yr][accId] = { anseOut: 0, dcOut: 0, regularOut: 0 };
      summary[yr] = { myNP: 0, wifeNP: 0, myPublicInc: 0, wifePublicInc: 0, target: 0, totalPriv: 0, totalInc: 0,
        retireTax: 0, pensionTax: 0, npTax: 0, totalTax: 0, shortfall: 0, inflFactor: 1 };
      balances[yr] = null; // null = 연간계획 미표시 (blank)
      continue;
    }

    // 1. 수익률 적용
    for (const accId of allAccIds) {
      if (WIFE_ACC_IDS.includes(accId) && yr < startYear) continue;
      const s = state[accId];
      const gain = s.total * r;
      s.regular += gain; s.total += gain;
    }

    // 1.5. 적립계획 입금 (savings plan deposits for this year)
    for (const accId of allAccIds) {
      const s = state[accId];
      const depositWon = getMonthlyPlanYearEndValueWon(accId, yr, r);
      if (depositWon <= 0) continue;
      const totalSimpleMw = getMonthlyPlanIncrManwon(accId, yr);
      const anseSimpleMw  = getMonthlyPlanAnseIncrManwon(accId, yr);
      const anseWon = totalSimpleMw > 0 ? depositWon * (anseSimpleMw / totalSimpleMw) : 0;
      s.anse    += anseWon;
      s.regular += depositWon - anseWon;
      s.total   += depositWon;
    }

    // 2. 공적연금 (국민연금 + 공무원연금 + 사학연금, 물가연동, 시작월 반영)
    const npCurrentYear = new Date().getFullYear();
    // 나 국민연금
    const myNPCfg = myPersonCfg.np || {};
    const myNPUse = myNPCfg.use !== false && myNPCfg.startYear > 0;
    const myNPActualYear = (myNPCfg.startYear || 0) + (myNPCfg.delayYears || 0);
    const myNPMonths = myNPUse ? (yr > myNPActualYear ? 12 : yr === myNPActualYear ? 13 - (myNPCfg.startMonth||1) : 0) : 0;
    const myNP = myNPMonths > 0
      ? (myNPCfg.monthlyManwon||0) * 10000 * myNPMonths * Math.pow(1+inf, yr - npCurrentYear)
        * (1 + 0.072*(myNPCfg.delayYears||0)) * (1 - 0.06*(myNPCfg.earlyYears||0))
      : 0;
    // 나 공무원연금
    const myGPCfg = myPersonCfg.gp || {};
    const myGPUse = myGPCfg.use && myGPCfg.startYear > 0;
    const myGPMonths = myGPUse ? (yr > myGPCfg.startYear ? 12 : yr === myGPCfg.startYear ? 13 - (myGPCfg.startMonth||1) : 0) : 0;
    const myGP = myGPMonths > 0
      ? (myGPCfg.monthlyManwon||0) * 10000 * myGPMonths * Math.pow(1+inf, yr - npCurrentYear)
        * (1 - 0.06*(myGPCfg.earlyYears||0))
      : 0;
    // 나 사학연금
    const mySPCfg = myPersonCfg.sp || {};
    const mySPUse = mySPCfg.use && mySPCfg.startYear > 0;
    const mySPActualYear = (mySPCfg.startYear || 0) + (mySPCfg.delayYears || 0);
    const mySPMonths = mySPUse ? (yr > mySPActualYear ? 12 : yr === mySPActualYear ? 13 - (mySPCfg.startMonth||1) : 0) : 0;
    const mySP = mySPMonths > 0
      ? (mySPCfg.monthlyManwon||0) * 10000 * mySPMonths * Math.pow(1+inf, yr - npCurrentYear)
        * (1 + 0.072*(mySPCfg.delayYears||0)) * (1 - 0.06*(mySPCfg.earlyYears||0))
      : 0;
    // 아내 국민연금
    const wifeNPCfg = wifePersonCfg.np || {};
    const wifeNPUse = wifeNPCfg.use !== false && wifeNPCfg.startYear > 0;
    const wifeNPActualYear = (wifeNPCfg.startYear || 0) + (wifeNPCfg.delayYears || 0);
    const wifeNPMonths = wifeNPUse ? (yr > wifeNPActualYear ? 12 : yr === wifeNPActualYear ? 13 - (wifeNPCfg.startMonth||1) : 0) : 0;
    const wifeNP = wifeNPMonths > 0
      ? (wifeNPCfg.monthlyManwon||0) * 10000 * wifeNPMonths * Math.pow(1+inf, yr - npCurrentYear)
        * (1 + 0.072*(wifeNPCfg.delayYears||0)) * (1 - 0.06*(wifeNPCfg.earlyYears||0))
      : 0;
    // 아내 공무원연금
    const wifeGPCfg = wifePersonCfg.gp || {};
    const wifeGPUse = wifeGPCfg.use && wifeGPCfg.startYear > 0;
    const wifeGPMonths = wifeGPUse ? (yr > wifeGPCfg.startYear ? 12 : yr === wifeGPCfg.startYear ? 13 - (wifeGPCfg.startMonth||1) : 0) : 0;
    const wifeGP = wifeGPMonths > 0
      ? (wifeGPCfg.monthlyManwon||0) * 10000 * wifeGPMonths * Math.pow(1+inf, yr - npCurrentYear)
        * (1 - 0.06*(wifeGPCfg.earlyYears||0))
      : 0;
    // 아내 사학연금
    const wifeSPCfg = wifePersonCfg.sp || {};
    const wifeSPUse = wifeSPCfg.use && wifeSPCfg.startYear > 0;
    const wifeSPActualYear = (wifeSPCfg.startYear || 0) + (wifeSPCfg.delayYears || 0);
    const wifeSPMonths = wifeSPUse ? (yr > wifeSPActualYear ? 12 : yr === wifeSPActualYear ? 13 - (wifeSPCfg.startMonth||1) : 0) : 0;
    const wifeSP = wifeSPMonths > 0
      ? (wifeSPCfg.monthlyManwon||0) * 10000 * wifeSPMonths * Math.pow(1+inf, yr - npCurrentYear)
        * (1 + 0.072*(wifeSPCfg.delayYears||0)) * (1 - 0.06*(wifeSPCfg.earlyYears||0))
      : 0;
    const myPublicInc   = myNP + myGP + mySP;
    const wifePublicInc = wifeNP + wifeGP + wifeSP;

    // 3. 인출 목표 및 계좌별 배분
    const basic     = (wp.basicWithdraw || 0) * 1_000_000;
    const wifeBasic = basic;
    // 퇴직소득세 연차별 감면
    const _yrFromStart = yr - startYear;
    const _benefit = _yrFromStart < 10 ? myB10 : _yrFromStart < 20 ? myB20 : myB30;
    const _rTR = myRTR_base * _benefit;
    let myRemaining, wifeRemaining, target;
    if (yr < startYear) {
      myRemaining = 0; wifeRemaining = 0; target = 0;
    } else {
      const activePeriod = periodsWithEnd.find(p => yr >= p.startYear && yr <= p.derivedEndYear);
      if (!activePeriod) {
        // 구간 없는 연도: 기본인출액만
        myRemaining   = basic;
        wifeRemaining = yr >= startYear ? wifeBasic : 0;
        target = myRemaining + wifeRemaining;
      } else if (activePeriod.type === 'pct') {
        // 인출율 모드: 각자 자기 계좌에서 %만큼
        const myBal   = myWithdrawIds.reduce((s, id) => s + Math.max(0, state[id].total), 0);
        const wifeIds = allAccIds.filter(id => WIFE_ACC_IDS.includes(id) || wifeExtraSet.has(id));
        const wifeBal = wifeIds.reduce((s, id) => s + Math.max(0, state[id].total), 0);
        const pctRawMy   = myBal  * (activePeriod.pct || 4) / 100;
        const pctRawWife = appSettings.hasWife && yr >= startYear ? wifeBal * (activePeriod.pct || 4) / 100 : 0;
        if ((activePeriod.publicPensionMode || 'include') === 'include') {
          myRemaining   = Math.max(0, pctRawMy   - myPublicInc   * (1 - npTR));
          wifeRemaining = Math.max(0, pctRawWife - wifePublicInc * (1 - npTR));
        } else {
          myRemaining   = pctRawMy;
          wifeRemaining = pctRawWife;
        }
        target = pctRawMy + pctRawWife;
      } else {
        // 고정가치/고정금액 모드 (nominal: inflFactor 미적용)
        const inflFactor      = activePeriod.type === 'nominal' ? 1 : Math.pow(1+inf, yr - todayYear);
        const totalNetTarget  = (activePeriod.totalAmount || 0) * 120_000 * inflFactor;
        const wifeBasisAmt    = yr >= startYear ? wifeBasic : 0;
        const wifeContribMode = activePeriod.wifeContrib || 'fixed';
        target = totalNetTarget;
        // 추정 사적소득 실효세율
        const privTotalBal    = allAccIds.reduce((s, id) => s + Math.max(0, state[id].total), 0);
        const anseTotalBal    = allAccIds.reduce((s, id) => s + Math.max(0, state[id].anse), 0);
        const dcTotalBal      = allAccIds.reduce((s, id) => s + Math.max(0, state[id].dcPrincipal || 0), 0);
        const regularTotalBal = Math.max(0, privTotalBal - anseTotalBal - dcTotalBal);
        const _pTRnow  = getPTR(myBY, yr);
        const estPrivRate = privTotalBal > 0
          ? (anseTotalBal * _pTRnow + dcTotalBal * _rTR + regularTotalBal * epTR) / privTotalBal
          : _pTRnow;
        const grossMult    = estPrivRate < 1 ? 1 / (1 - estPrivRate) : 1;
        const pubNet       = (myPublicInc + wifePublicInc) * (1 - npTR);
        const pubContrib   = (activePeriod.publicPensionMode || 'include') === 'include' ? pubNet : 0;
        const basicNet     = basic * (1 - estPrivRate);
        const wifeBasisNet = wifeBasisAmt * (1 - estPrivRate);
        if (appSettings.hasWife && wifeContribMode === 'ratio' && wifeBasisAmt > 0) {
          // 비율기여: 공적연금 차감(포함모드) 후 wifeRatio% 배우자, 나머지 본인
          const privateNetNeeded = Math.max(0, target - pubContrib);
          const pgNeeded         = privateNetNeeded * grossMult;
          const wifeR            = (activePeriod.wifeRatio || 50) / 100;
          wifeRemaining          = pgNeeded * wifeR;
          myRemaining            = pgNeeded * (1 - wifeR);
        } else {
          // 고정금액(fixed) / 부족분충당(topup): 사적 필요액을 설정대로 직접 배분
          const netPrivateNeeded = Math.max(0, totalNetTarget - pubContrib);
          let myNetNeeded, wifeNetNeeded;
          if (appSettings.hasWife && yr >= startYear) {
            if (wifeContribMode === 'topup') {
              const myNetFixed = (activePeriod.myAmount || 0) * 120_000;
              myNetNeeded   = Math.min(netPrivateNeeded, myNetFixed);
              wifeNetNeeded = Math.max(0, netPrivateNeeded - myNetNeeded);
            } else {
              const wifeNetFixed = (activePeriod.wifeAmount || 0) * 120_000;
              wifeNetNeeded = Math.min(netPrivateNeeded, wifeNetFixed);
              myNetNeeded   = Math.max(0, netPrivateNeeded - wifeNetNeeded);
            }
          } else {
            myNetNeeded   = netPrivateNeeded;
            wifeNetNeeded = 0;
          }
          myRemaining   = myNetNeeded   * grossMult;
          wifeRemaining = wifeNetNeeded * grossMult;
        }
      }
    }
    let totalRT = 0, totalPT = 0;

    // 퇴직소득세 연차별 감면 (1~10년차 benefit10, 11~20년차 benefit20, 21년차~ benefit30)
    const yrFromStart = yr - startYear;
    const benefit = yrFromStart < 10 ? myB10 : yrFromStart < 20 ? myB20 : myB30;
    const rTR = myRTR_base * benefit;

    // 4. 우선순위 인출: ①안세공=0 계좌 연금세(기본액) → ②안세공>0 계좌 안세공 → ③퇴직금 → ④연금세(전체소진)
    const doWithdraw = (accIds, budget, basisCap) => {
      for (const id of accIds) withdrawals[yr][id] = { anseOut: 0, dcOut: 0, regularOut: 0, pensionTax: 0 };
      let rem = budget;
      const snapAnse = Object.fromEntries(accIds.map(id => [id, state[id].anse]));
      const dcId = accIds.find(id => DC_ACC_IDS.has(id)) || null;

      // ① 안세공=0 계좌(DC 제외): 안세공·퇴직금이 남아 있는 동안 그룹 전체에서 기본인출액 1회만
      const hasHighPri = accIds.some(id => snapAnse[id] > 0 || (state[id].dcPrincipal || 0) > 0);
      if (hasHighPri) {
        let basicRem = basisCap;
        for (const id of accIds) {
          if (basicRem <= 0 || rem <= 0 || snapAnse[id] > 0 || DC_ACC_IDS.has(id)) continue;
          const take = Math.min(state[id].regular, basicRem, rem);
          if (take > 0) {
            const pt = take * getPTR((id.startsWith('wife_') || wifeExtraSet.has(id)) ? wifeBY : myBY, yr);
            withdrawals[yr][id].regularOut += take; withdrawals[yr][id].pensionTax += pt;
            state[id].regular -= take; state[id].total -= take; totalPT += pt; rem -= take; basicRem -= take;
          }
        }
      }
      // ② 안세공>0 계좌: 안세공 소진
      for (const id of accIds) {
        if (rem <= 0 || snapAnse[id] <= 0) continue;
        const take = Math.min(state[id].anse, rem);
        if (take > 0) { withdrawals[yr][id].anseOut += take; state[id].anse -= take; state[id].total -= take; rem -= take; }
      }
      // ③ DC 퇴직금 인출
      if (dcId && state[dcId].dcPrincipal > 0 && rem > 0) {
        const take = Math.min(state[dcId].dcPrincipal, rem);
        withdrawals[yr][dcId].dcOut += take; state[dcId].dcPrincipal -= take; state[dcId].total -= take;
        totalRT += take * rTR; rem -= take;
      }
      // ④ 안세공·퇴직금 모두 소진 시 → 연금세에서 필요한만큼 (세율은 임계치 체크 후 결정)
      if (accIds.every(id => state[id].anse === 0) &&
          (!dcId || state[dcId].dcPrincipal === 0) && rem > 0) {
        for (const id of accIds) {
          if (rem <= 0) break;
          const take = Math.min(state[id].regular, rem);
          if (take > 0) {
            const pt = take * getPTR((id.startsWith('wife_') || wifeExtraSet.has(id)) ? wifeBY : myBY, yr);
            withdrawals[yr][id].regularOut += take; withdrawals[yr][id].pensionTax += pt;
            state[id].regular -= take; state[id].total -= take; totalPT += pt; rem -= take;
          }
        }
      }
    };

    // 1500만원 개인별 임계치 체크: 초과 시 해당 사람의 전체 regularOut을 epTR로 재계산
    const applyPensionTaxThreshold = (accIds) => {
      const totalReg = accIds.reduce((a, id) => a + withdrawals[yr][id].regularOut, 0);
      if (totalReg > PENSION_THRESHOLD) {
        for (const id of accIds) {
          const newPT = withdrawals[yr][id].regularOut * epTR;
          totalPT += newPT - withdrawals[yr][id].pensionTax;
          withdrawals[yr][id].pensionTax = newPT;
        }
      }
    };

    // 2-pass 보정용 상태 스냅샷 (목표액 구간에서만 사용)
    const _snap = {};
    for (const id of allAccIds) _snap[id] = { ...state[id] };

    // DEBUG: 아내 인출 추적
    if (yr <= startYear + 2) {
      const _wifeIds = getActiveWifeAccIds();
      const _apDbg = periodsWithEnd.find(p => yr >= p.startYear && yr <= p.derivedEndYear);
      _wdLog(`[WD-DEBUG yr=${yr}] myExtraIds=${JSON.stringify(myExtraIds)}`);
      _wdLog(`[WD-DEBUG yr=${yr}] wifeExtraIds=${JSON.stringify(wifeExtraIds)}`);
      _wdLog(`[WD-DEBUG yr=${yr}] myWithdrawIds=${JSON.stringify(myWithdrawIds)}`);
      _wdLog(`[WD-DEBUG yr=${yr}] activeWifeIds=${JSON.stringify(_wifeIds)}`);
      _wdLog(`[WD-DEBUG yr=${yr}] activePeriod=`, JSON.stringify({ type: _apDbg?.type, wifeContrib: _apDbg?.wifeContrib, wifeAmount: _apDbg?.wifeAmount, totalAmount: _apDbg?.totalAmount, wifeRatio: _apDbg?.wifeRatio, publicPensionMode: _apDbg?.publicPensionMode }));
      _wdLog(`[WD-DEBUG yr=${yr}] myPublicInc=${myPublicInc} wifePublicInc=${wifePublicInc} basic=${basic}`);
      _wdLog(`[WD-DEBUG yr=${yr}] myRemaining=${myRemaining} wifeRemaining=${wifeRemaining}`);
      _wifeIds.forEach(id => _wdLog(`[WD-DEBUG yr=${yr}] state[${id}]=`, JSON.stringify(state[id])));
      myWithdrawIds.forEach(id => { if(state[id]?.total > 0) _wdLog(`[WD-DEBUG yr=${yr}] myState[${id}]=`, JSON.stringify(state[id])); });
    }

    doWithdraw(myWithdrawIds, myRemaining, basic);
    applyPensionTaxThreshold(myWithdrawIds);
    doWithdraw(getActiveWifeAccIds(), wifeRemaining, wifeBasic);
    applyPensionTaxThreshold(getActiveWifeAccIds());

    // DEBUG: 1st pass 결과 확인
    if (yr <= startYear + 2) {
      const _wifeIds2 = getActiveWifeAccIds();
      _wdLog(`[WD-DEBUG yr=${yr}] AFTER 1st doWithdraw:`);
      _wifeIds2.forEach(id => _wdLog(`[WD-DEBUG yr=${yr}] wd1[${id}]=`, JSON.stringify(withdrawals[yr][id])));
    }

    // 고정금액 구간에서 세후 실수령액 = target 2차 보정 (pct 모드는 gross 직접 계산이므로 불필요)
    const _activePeriod2p = yr >= startYear ? periodsWithEnd.find(p => yr >= p.startYear && yr <= p.derivedEndYear) : null;
    const _2passActive = yr >= startYear && (!_activePeriod2p || _activePeriod2p.type !== 'pct');
    if (_2passActive) {
      const _priv1 = allAccIds.reduce((s, id) =>
        s + withdrawals[yr][id].anseOut + withdrawals[yr][id].dcOut + withdrawals[yr][id].regularOut, 0);
      const _pubContrib2p = (_activePeriod2p?.publicPensionMode || 'include') === 'include'
        ? (myPublicInc + wifePublicInc) * (1 - npTR) : 0;
      const _actualNet1 = _priv1 - totalRT - totalPT + _pubContrib2p;
      const _deficit = target - _actualNet1;
      if (yr <= startYear + 2) _wdLog(`[WD-DEBUG yr=${yr}] 2pass: priv1=${_priv1} actualNet1=${_actualNet1} target=${target} deficit=${_deficit}`);
      if (Math.abs(_deficit) > 10000) {
        // 패스1 직후 나의 regularOut으로 한계세율 결정 (1500만원 초과 여부 반영)
        const myRegOut1 = myWithdrawIds.reduce((a, id) => a + withdrawals[yr][id].regularOut, 0);
        const _margRate = allAccIds.some(id => state[id].anse > 0) ? 0
          : allAccIds.some(id => DC_ACC_IDS.has(id) && state[id].dcPrincipal > 0) ? rTR
          : myRegOut1 >= PENSION_THRESHOLD ? epTR : getPTR(myBY, yr);
        const _corrGross = _deficit / (1 - _margRate);
        // 상태 복원 후 보정된 금액으로 재인출
        for (const id of allAccIds) state[id] = { ..._snap[id] };
        for (const id of allAccIds) withdrawals[yr][id] = { anseOut: 0, dcOut: 0, regularOut: 0, pensionTax: 0 };
        totalRT = 0; totalPT = 0;
        if (_activePeriod2p && _activePeriod2p.wifeContrib === 'ratio' && appSettings.hasWife) {
          // 비율 기여: 비율 유지하며 보정
          const wifeR2 = (_activePeriod2p.wifeRatio || 50) / 100;
          myRemaining   = Math.max(0, myRemaining   + _corrGross * (1 - wifeR2));
          wifeRemaining = Math.max(0, wifeRemaining + _corrGross * wifeR2);
        } else {
          // fixed/topup: 실제 인출 중인 쪽으로 보정
          if (myRemaining === 0 && wifeRemaining > 0) {
            wifeRemaining = Math.max(0, wifeRemaining + _corrGross);
          } else {
            myRemaining = Math.max(0, myRemaining + _corrGross);
          }
        }
        doWithdraw(myWithdrawIds, myRemaining, basic);
        applyPensionTaxThreshold(myWithdrawIds);
        doWithdraw(getActiveWifeAccIds(), wifeRemaining, wifeBasic);
        applyPensionTaxThreshold(getActiveWifeAccIds());
        if (yr <= startYear + 2) {
          const _wifeIds3 = getActiveWifeAccIds();
          _wdLog(`[WD-DEBUG yr=${yr}] AFTER 2nd pass: myR=${myRemaining} wifeR=${wifeRemaining}`);
          _wifeIds3.forEach(id => _wdLog(`[WD-DEBUG yr=${yr}] wd2[${id}]=`, JSON.stringify(withdrawals[yr][id])));
        }
      }
    }

    const totalPriv = allAccIds.reduce((s, id) =>
      s + withdrawals[yr][id].anseOut + withdrawals[yr][id].dcOut + withdrawals[yr][id].regularOut, 0);
    const npTax = (myPublicInc + wifePublicInc) * npTR;
    summary[yr] = {
      myNP, wifeNP, myGP, mySP, wifeGP, wifeSP, myPublicInc, wifePublicInc, target,
      totalPriv, totalInc: totalPriv + myPublicInc + wifePublicInc,
      retireTax: totalRT, pensionTax: totalPT, npTax,
      totalTax: totalRT + totalPT + npTax,
      retireTaxRateEff: rTR,
      shortfall: yr >= startYear
        ? Math.max(0, target - (totalPriv + myPublicInc + wifePublicInc - totalRT - totalPT - npTax))
        : Math.max(0, target - myPublicInc - wifePublicInc - totalPriv),
      inflFactor: Math.pow(1+inf, yr - startYear),
    };
    balances[yr] = {};
    for (const accId of allAccIds) balances[yr][accId] = { ...state[accId] };
  }
  return { years, withdrawals, balances, summary, initState, allAccIds, startYear, wifeExtraIds };
}
