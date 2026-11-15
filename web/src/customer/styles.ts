// Customer UI のスタイル(スマホ幅前提。外部 CSS・依存なし)
export const CSS = `
.app { font-family: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif; color: #222; max-width: 560px; margin: 0 auto; min-height: 100vh; background: #fafafa; }
.app * { box-sizing: border-box; }
.top { background: #c62828; color: #fff; padding: 14px 16px; font-weight: 700; font-size: 18px; position: sticky; top: 0; z-index: 2; }
.note { padding: 24px 16px; color: #666; }
.error { margin: 12px 16px; padding: 10px 12px; background: #fdecea; color: #b71c1c; border-radius: 8px; font-size: 14px; }
.menu h2 { margin: 20px 16px 6px; font-size: 15px; color: #555; border-bottom: 2px solid #c62828; padding-bottom: 4px; }
.menu ul { list-style: none; margin: 0; padding: 0; }
.menu li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; background: #fff; border-bottom: 1px solid #eee; min-height: 56px; }
.menu li.soldout { background: #f3f3f3; color: #999; }
.menu .info { display: flex; flex-direction: column; gap: 2px; }
.menu .name { font-size: 16px; }
.menu .price { font-size: 14px; color: #666; }
.menu li.soldout .price { color: #aaa; }
.badge { font-size: 13px; font-weight: 700; color: #777; border: 1px solid #bbb; border-radius: 999px; padding: 4px 10px; white-space: nowrap; }
.add { min-width: 64px; min-height: 40px; border: 1px solid #c62828; background: #fff; color: #c62828; border-radius: 8px; font-size: 15px; font-weight: 700; }
.stepper { display: inline-flex; align-items: center; gap: 4px; }
.stepper button { width: 40px; height: 40px; border: 1px solid #c62828; background: #fff; color: #c62828; border-radius: 8px; font-size: 20px; line-height: 1; }
.stepper output { min-width: 32px; text-align: center; font-size: 17px; font-weight: 700; }
.spacer { height: 96px; }
.cartbar { position: fixed; left: 0; right: 0; bottom: 0; max-width: 560px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px calc(12px + env(safe-area-inset-bottom)); background: #fff; border-top: 1px solid #ddd; box-shadow: 0 -2px 8px rgba(0,0,0,.06); }
.cartbar .sum { display: flex; flex-direction: column; font-size: 13px; color: #666; }
.cartbar .sum b { font-size: 18px; color: #222; }
.primary { flex: 1; max-width: 240px; min-height: 48px; border: 0; border-radius: 10px; background: #c62828; color: #fff; font-size: 16px; font-weight: 700; }
.primary:disabled { background: #ccc; }
.secondary { display: block; width: calc(100% - 32px); margin: 8px 16px 32px; min-height: 48px; border: 1px solid #c62828; border-radius: 10px; background: #fff; color: #c62828; font-size: 16px; font-weight: 700; }
.tracking { padding: 24px 0; text-align: center; }
.tracking .label { margin: 0; color: #666; font-size: 14px; }
.tracking .callno { margin: 0; font-size: 72px; font-weight: 800; line-height: 1.1; color: #c62828; }
.tracking .status { display: inline-block; margin: 8px 0; padding: 6px 18px; border-radius: 999px; background: #fff3e0; color: #e65100; font-size: 20px; font-weight: 700; }
.tracking .status.ready { background: #e8f5e9; color: #2e7d32; }
.ready-note { margin: 4px 16px 0; color: #2e7d32; font-weight: 700; }
.steps { list-style: none; display: flex; gap: 6px; margin: 20px 16px; padding: 0; }
.steps li { flex: 1; padding: 8px 4px; border-radius: 8px; background: #eee; color: #999; font-size: 13px; }
.steps li.done { background: #ffcdd2; color: #b71c1c; }
.steps li.current { background: #c62828; color: #fff; font-weight: 700; }
.receipt { text-align: left; margin: 0 16px 16px; background: #fff; border: 1px solid #eee; border-radius: 10px; padding: 4px 14px 10px; }
.receipt h2 { font-size: 15px; color: #555; }
.receipt ul { list-style: none; margin: 0; padding: 0; }
.receipt li { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px dashed #eee; }
.receipt .total { display: flex; justify-content: space-between; margin: 10px 0 0; font-size: 17px; }
`;
