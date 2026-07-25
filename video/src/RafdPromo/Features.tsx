import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT_BODY, FONT_HEADING } from "./theme";

const FEATURES = [
  { icon: "⚖️", title: "بدون تحيّز", desc: "قرارات موضوعية بمعايير موحّدة" },
  { icon: "🎯", title: "معاييرك الخاصة", desc: "التقييم يُبنى على شروط جهتك" },
  { icon: "⏱️", title: "معالجة فورية", desc: "النتائج في دقائق معدودة" },
  { icon: "📊", title: "دقة تصنيف عالية", desc: "قبول ورفض وترتيب أفضليات" },
];

export const Features: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const titleIn = spring({ frame, fps, config: { damping: 100 } });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 18, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        gap: 80,
        opacity: fadeOut,
        direction: "rtl",
      }}
    >
      <div
        style={{
          fontFamily: FONT_HEADING,
          fontWeight: 800,
          fontSize: 84,
          color: COLORS.white,
          opacity: titleIn,
          transform: `translateY(${(1 - titleIn) * 40}px)`,
        }}
      >
        كل ما تحتاجه في منصة واحدة
      </div>
      <div style={{ display: "flex", gap: 40 }}>
        {FEATURES.map((f, i) => {
          const cardIn = spring({
            frame: frame - 18 - i * 10,
            fps,
            config: { damping: 15, mass: 0.7 },
          });
          return (
            <div
              key={f.title}
              style={{
                width: 380,
                borderRadius: 32,
                padding: "56px 36px",
                background: "rgba(255,255,255,.06)",
                border: "1px solid rgba(255,255,255,.14)",
                textAlign: "center",
                opacity: cardIn,
                transform: `translateY(${(1 - cardIn) * 100}px)`,
              }}
            >
              <div style={{ fontSize: 84, marginBottom: 28 }}>{f.icon}</div>
              <div
                style={{
                  fontFamily: FONT_HEADING,
                  fontWeight: 700,
                  fontSize: 44,
                  color: COLORS.goldLight,
                  marginBottom: 18,
                }}
              >
                {f.title}
              </div>
              <div
                style={{
                  fontFamily: FONT_BODY,
                  fontSize: 30,
                  lineHeight: 1.7,
                  color: COLORS.muted,
                }}
              >
                {f.desc}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
