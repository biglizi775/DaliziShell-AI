# 《一处，自成秩序》代码配乐

原创合成配乐，96 秒，80 BPM、4/4 拍、32 小节。D 大调 / B 小调，Dmaj9 → Bm9 → Gmaj9 → Asus/add9 和声循环。每四小节对应一幕（12 秒）。开场稀疏铺陈；本地文件操作加入低频与脉冲；远程工作区节奏最完整；目录记忆段减法留白；片尾以高音动机与长尾收束。

所有声音由 `dist/audio.js` 直接计算 PCM 波形：有限谐波铺底、正弦 FM 木琴、正弦与二次谐波贝斯、滑音底鼓、种子噪声打击乐与转场气流。混响采用四路阻尼梳状滤波器，回声采用交叉反馈延迟；包络、滤波、声像和柔和饱和全部在代码中完成。无音频素材、采样、SoundFont、外部依赖或网络请求。UI 提示声使用同调性短音。没有人声。

## 接口

```js
import { createScore, encodeWav } from './dist/audio.js';
const buffer = await createScore({ duration: 96, sampleRate: 48000 });
const wav = encodeWav(buffer); // 48 kHz / stereo / signed 16-bit PCM
```

`createScore` 使用浏览器 `OfflineAudioContext` 分配标准 `AudioBuffer`，以波表 DSP 直接填充声道，避免庞大的节点图。Windows Edge 实测 96 秒 / 48 kHz 完整合成约 0.41 秒，可复用缓存；不同设备耗时会变化。播放器应在用户手势后创建或恢复 `AudioContext`，使用 `AudioBufferSourceNode.start(0, offset)` 与视觉时间线对齐；暂停后重建 source 以实现任意跳转。文件导出可使用同一缓冲区生成 WAV，再与视频混流。

最终双声道联合峰值归一化至 0.89（约 -1 dBFS），前后包含抗点击淡入淡出。实测全长双声道 RMS 约 -17.2 dBFS，无非有限值；导出的 16 位 WAV 为 18,432,044 字节。随机源固定，重导出的编曲和混响一致。音频时长与画面一致，无需网络或浏览器实时录音。
