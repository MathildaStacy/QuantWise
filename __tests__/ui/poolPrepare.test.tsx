/**
 * 指数池「准备数据」卡：按钮的读屏文字跟着状态换。Android 上 Pressable 没有 accessibilityLabel 时，
 * busy 变回 false 不会清掉原来的「busy」，下载停下后按钮一直读「busy」（v1.10.0 验收时在模拟器上看到）。
 */
import ReactTestRenderer, { act } from 'react-test-renderer';
import { PrepareCard, type PrepState } from '../../src/ui/charts/PoolPrepare';

test('准备数据卡：下载中、停下、过期三种状态，按钮的读屏文字和按钮上的字一致', async () => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  const card = (prep: PrepState | null, pending = false) => (
    <PrepareCard pool="hs300" pending={pending} prep={prep} onStart={() => {}} onStop={() => {}} after={pending ? '并重做这次检验' : undefined} />
  );
  const main = () => tree.root.findAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityState)[0].props;
  await act(async () => {
    tree = ReactTestRenderer.create(card({ pool: 'hs300', done: 58, total: 300, running: true }));
  });
  expect(main().accessibilityLabel).toBe('下载中…');
  expect(main().accessibilityState).toEqual({ disabled: true, busy: true });
  await act(async () => tree.update(card({ pool: 'hs300', done: 220, total: 300, running: false, error: '连续 13 只没取到' })));
  expect(main().accessibilityLabel).toBe('更新数据');
  expect(main().accessibilityState).toEqual({ disabled: false, busy: false });
  await act(async () => tree.update(card(null, true)));
  expect(main().accessibilityLabel).toBe('准备数据并重做这次检验');
});
