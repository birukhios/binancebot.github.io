const FUTURES_TAKER_FEE_RATE = 0.0004;
const FUTURES_MAKER_FEE_RATE = 0.0002;

export { FUTURES_TAKER_FEE_RATE, FUTURES_MAKER_FEE_RATE };

export interface MappedPosition {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  breakEvenPrice: string | null;
  markPrice: string;
  liquidationPrice: string;
  marginRatioPct: number;
  marginType: string;
  isolatedMargin: string;
  initialMargin: number;
  unrealizedProfit: string;
  roiPct: number;
  estCloseFeeUsdt: number;
  estRoundTripFeeUsdt: number;
  netUnrealizedAfterCloseFee: number;
  netRoiPct: number;
  leverage: string;
  notional: number;
  estFundingFee: number;
  fundingRate: number;
  nextFundingTime: number | null;
  tpTargetUsdt: number;
  tpTargetPrice: number | null;
}

export interface MappedOrder {
  symbol: string;
  side: string;
  price: string;
  origQty: string;
  executedQty: string;
  status: string;
  orderId: number;
  clientOrderId: string;
  notional: number;
  estMakerFeeUsdt: number;
}

export function mapPositions(
  risk: any[],
  premiumIndex: any[],
  accountPositions: any[],
  marginBalance: number,
  symbolConfigs: Map<string, any>,
): MappedPosition[] {
  const acctByKey = new Map<string, any>(
    accountPositions.map((p: any) => [`${p.symbol}:${p.positionSide}`, p]),
  );
  const premiumBySym = new Map<string, any>(premiumIndex.map((p) => [p.symbol, p]));

  return risk
    .filter((p: any) => parseFloat(p.positionAmt) !== 0)
    .map((p: any) => {
      const amt = parseFloat(p.positionAmt);
      const entry = parseFloat(p.entryPrice) || 0;
      const premiumMark = parseFloat(premiumBySym.get(p.symbol)?.markPrice ?? "0") || 0;
      const mark = premiumMark > 0 ? premiumMark : parseFloat(p.markPrice) || 0;
      const upnl =
        entry > 0 && mark > 0 ? (mark - entry) * amt : parseFloat(p.unRealizedProfit) || 0;
      const notional = Math.abs(amt * mark) || Math.abs(parseFloat(p.notional ?? "0")) || 0;
      const estCloseFeeUsdt = notional * FUTURES_TAKER_FEE_RATE;
      const estRoundTripFeeUsdt = notional * (FUTURES_TAKER_FEE_RATE + FUTURES_MAKER_FEE_RATE);
      const netUnrealizedAfterCloseFee = upnl - estCloseFeeUsdt;
      const leverage = parseFloat(p.leverage) || 1;
      const initialMargin = leverage > 0 ? notional / leverage : 0;
      const roiPct = initialMargin > 0 ? (upnl / initialMargin) * 100 : 0;
      const netRoiPct =
        initialMargin > 0 ? (netUnrealizedAfterCloseFee / initialMargin) * 100 : 0;
      const acctPos = acctByKey.get(`${p.symbol}:${p.positionSide}`);
      const maintMargin = parseFloat(acctPos?.maintMargin ?? "0") || 0;
      const isolated = p.marginType === "isolated";
      const isolatedWallet = parseFloat(p.isolatedWallet ?? "0") || 0;
      const denom = isolated ? isolatedWallet + upnl : marginBalance;
      const marginRatioPct = denom > 0 ? (maintMargin / denom) * 100 : 0;
      const fundingRate = parseFloat(premiumBySym.get(p.symbol)?.lastFundingRate ?? "0") || 0;
      const estFundingFee = notional * fundingRate * (amt >= 0 ? -1 : 1);
      const nextFundingTime = premiumBySym.get(p.symbol)?.nextFundingTime ?? null;
      const symCfg = symbolConfigs.get(p.symbol);
      const spacingPct = Number(symCfg?.grid_spacing_pct ?? 0);
      const tpTargetUsdt = notional * (spacingPct / 100);
      const tpTargetPrice =
        spacingPct > 0 && entry > 0
          ? entry * (1 + ((amt >= 0 ? 1 : -1) * spacingPct) / 100)
          : null;
      return {
        symbol: p.symbol,
        positionAmt: p.positionAmt,
        entryPrice: p.entryPrice,
        breakEvenPrice: p.breakEvenPrice ?? null,
        markPrice: String(mark),
        liquidationPrice: p.liquidationPrice,
        marginRatioPct,
        marginType: p.marginType,
        isolatedMargin: p.isolatedMargin,
        initialMargin,
        unrealizedProfit: String(upnl),
        roiPct,
        estCloseFeeUsdt,
        estRoundTripFeeUsdt,
        netUnrealizedAfterCloseFee,
        netRoiPct,
        leverage: p.leverage,
        notional,
        estFundingFee,
        fundingRate,
        nextFundingTime,
        tpTargetUsdt,
        tpTargetPrice,
      };
    });
}

export function mapOpenOrders(liveOrders: any[]): MappedOrder[] {
  return liveOrders
    .filter((o: any) => String(o.clientOrderId ?? "").startsWith(`grid_${o.symbol}_`))
    .map((o: any) => ({
      symbol: o.symbol,
      side: o.side,
      price: o.price,
      origQty: o.origQty,
      executedQty: o.executedQty,
      status: o.status,
      orderId: o.orderId,
      clientOrderId: o.clientOrderId,
      notional: Number(o.origQty ?? 0) * Number(o.price ?? 0),
      estMakerFeeUsdt: Number(o.origQty ?? 0) * Number(o.price ?? 0) * FUTURES_MAKER_FEE_RATE,
    }));
}
