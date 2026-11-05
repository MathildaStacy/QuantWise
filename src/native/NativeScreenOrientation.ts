import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * 全屏看表时临时横过来（PM 走查第 1 项）：App 没有锁方向，但很多人关了系统自动旋转。
 * mode 是 'landscape'、'portrait' 或 'auto'（交回系统设置）。现在只有 Android 实现，iOS 上是 null。
 */
export interface Spec extends TurboModule {
  set(mode: string): void;
}

export default TurboModuleRegistry.get<Spec>('ScreenOrientation');
