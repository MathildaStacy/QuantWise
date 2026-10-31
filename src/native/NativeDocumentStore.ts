import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * 导出文件（交割单 CSV 等）：写到 App 缓存目录，再打开系统分享面板，由用户选保存位置或发送对象。
 * 只传文件名和内容，不传任何路径。现在只有 Android 实现，iOS 上是 null。
 */
export interface Spec extends TurboModule {
  /** Android 上分享面板打开就返回 'opened'（拿不到用户最后保存没有）。 */
  writeAndShare(name: string, base64: string, mime: string): Promise<string>;
  pickText(): Promise<string | null>;
  /** 清理上一次 App 进程留下的导出文件。 */
  cleanupExports(): Promise<void>;
  /** QuantWise：用系统 PdfRenderer 读 PDF 页数（决定怎么给 MinerU 分片）；path 是 App 私有目录里的文件。 */
  pdfPageCount(path: string): Promise<number>;
}

export default TurboModuleRegistry.get<Spec>('DocumentStore');
