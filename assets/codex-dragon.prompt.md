# Codex 白龙：默认角色素材

- 文件：`assets/codex-dragon.png`
- 用途：Windows 悬浮窗默认角色，以及托盘图标的源图。
- 生成日期：2026-10-07。
- 方式：内置 `image_gen`；`transparent_background: true`。
- 角色参考：由用户提供的白发龙角女性设定图生成的上一版白龙角色。
- 构图参考：上游 `assets/DSniang1.png`，仅参考头部与上半身占满画面的近景构图。
- 本次修正：从全身改为胸口以上的近景，放大头脸，长发和肩部自然延伸至画面底边。
- 输出：1254 × 1254 RGBA PNG；保留工具生成的透明通道，未进行后期抠图或重绘。

## 最终提示词

```text
Use case: identity-preserve.
Asset type: replacement transparent PNG portrait sprite for a 150-pixel desktop companion.

Input image 1 is the EDIT TARGET and the character identity reference: the existing white-haired dragon woman mascot.
Input image 2 is a COMPOSITION AND FRAMING REFERENCE ONLY: the original blue-haired desktop mascot. Do not copy its blue hair, maid outfit, or character identity.

Primary request: Redraw image 1 as a tightly framed chibi HEAD-AND-SHOULDERS / UPPER-CHEST PORTRAIT matching the head-dominant close-up composition of image 2. The previous full-body sprite made the face much too small in the desktop widget. Fix this by filling the square canvas with the big head, hair, horns, face, and just a little upper chest.

Composition requirements:
- Square canvas, true transparent background.
- The head, hair and horns occupy about 80–85 percent of the image height and nearly the entire width. Large face and large clearly readable violet eyes, comparable in visual size to the eyes and face in reference image 2.
- Keep both horn tips inside the upper edge with a small margin. Keep a small ahoge. Do not let the horns become so tall that the face shrinks.
- The chin is around the lower three-quarters of the canvas; the high collar, knot ornament and shoulders occupy only the bottom fifth.
- The long white hair and shoulders continue naturally out of the bottom edge, cropped like the original mascot portrait. This is an intentional close-up crop, not a complete freestanding doll.
- No lower body, skirt, waist, legs, feet or hands. No full-body pose. Wings and tail stay outside this close-up crop; do not zoom out to include them.
- Face almost forward with a slight tilt, quiet attentive expression and tiny gentle smile.

Keep the identity of image 1: silver-white hair, pale lilac segmented dragon horns, pointed ears, lavender-purple eyes, dark interwoven six-loop hair ornament on the viewer-right side, white high-collared clothing, pale lilac shadows, soft blush. Preserve its polished clean anime chibi illustration style, with crisp dark plum contours and simplified detail readable at small size.
Background must be actual alpha transparency. No solid white or black background, no painted checkerboard, frame, circle, drop shadow, halo, background scene, text, captions, watermark, or extra characters.
Change the framing and composition only; retain the recognisable white dragon character.
```
