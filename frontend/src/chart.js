import { CandlestickSeries, CrosshairMode, TickMarkType, createChart } from 'lightweight-charts';

const IST = 'Asia/Kolkata';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const hoverFormatter = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const istYear = new Intl.DateTimeFormat('en-IN', { timeZone: IST, year: 'numeric' });
const istMonth = new Intl.DateTimeFormat('en-IN', { timeZone: IST, month: 'short' });
const istDay = new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: '2-digit' });
const istTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const istTimeWithSeconds = new Intl.DateTimeFormat('en-GB', {
  timeZone: IST,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function createSMCChart(container) {
  const chart = createChart(container, {
    autoSize: true,
    layout: {
      background: { color: '#0b0d12' },
      textColor: '#b2b5be',
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      panes: { separatorColor: '#242a36', separatorHoverColor: '#2f3745' },
    },
    grid: {
      vertLines: { color: '#151a23' },
      horzLines: { color: '#151a23' },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: '#4b5566', labelBackgroundColor: '#3179f5' },
      horzLine: { color: '#4b5566', labelBackgroundColor: '#3179f5' },
    },
    rightPriceScale: {
      borderColor: '#242a36',
      scaleMargins: { top: 0.08, bottom: 0.08 },
    },
    timeScale: {
      borderColor: '#242a36',
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 10,
      barSpacing: 5,
      tickMarkFormatter: (time, tickMarkType) => {
        if (typeof time === 'number') {
          const date = new Date(time * 1000);
          if (tickMarkType === TickMarkType.Year) return istYear.format(date);
          if (tickMarkType === TickMarkType.Month) return istMonth.format(date);
          if (tickMarkType === TickMarkType.DayOfMonth) return istDay.format(date);
          if (tickMarkType === TickMarkType.TimeWithSeconds) {
            return istTimeWithSeconds.format(date);
          }
          return istTime.format(date);
        }
        if (time && typeof time === 'object' && time.year) {
          if (tickMarkType === TickMarkType.Year) return String(time.year);
          if (tickMarkType === TickMarkType.Month) return MONTHS[time.month - 1] || '';
          return String(time.day).padStart(2, '0');
        }
        return String(time);
      },
    },
    localization: {
      timeFormatter: (time) => {
        if (typeof time === 'number') {
          return hoverFormatter.format(new Date(time * 1000));
        }
        if (time && typeof time === 'object' && time.year) {
          return `${String(time.day).padStart(2, '0')} ${MONTHS[time.month - 1]} ${time.year}`;
        }
        return String(time);
      },
    },
  });

  const series = chart.addSeries(CandlestickSeries, {
    upColor: '#089981',
    downColor: '#f23645',
    borderVisible: false,
    wickUpColor: '#089981',
    wickDownColor: '#f23645',
    priceLineVisible: false,
    lastValueVisible: true,
  });

  return { chart, series };
}

export function visibleBarsForResolution(resolution) {
  if (resolution === '1') return 700;
  if (resolution === '3') return 500;
  if (resolution === '5') return 420;
  if (resolution === '15') return 340;
  if (resolution === '30') return 280;
  if (resolution === '60') return 240;
  return 260;
}
