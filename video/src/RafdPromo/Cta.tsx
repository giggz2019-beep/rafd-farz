import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT_BODY, FONT_HEADING } from "./theme";

export const Cta: React.FC<{ ctaText: string }> = ({ ctaText }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const logoIn = spring({ frame, fps, config: { damping: 14, mass: 0.8 } });
  const btnIn = spring({ frame: frame - 20, fps, config: { damping: 12 } });
  const pulse = 1 + Math.sin(frame / 9) * 0.02;
  const fadeOut = interpolate(
    frame,
    [durationInFrames - 20, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        gap: 56,
        opacity: fadeOut,
        direction: "rtl",
      }}
    >
      <div
        style={{
          background: COLORS.white,
          borderRadius: 32,
          padding: "28px 64px",
          transform: `scale(${logoIn})`,
          boxShadow: "0 24px 70px rgba(0,0,0,.4)",
        }}
      >
        <Img
          src={staticFile("rafd-logo.png")}
          style={{ width: 440, display: "block" }}
        />
      </div>
      <div
        style={{
          opacity: btnIn,
          transform: `scale(${btnIn * pulse})`,
          background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.accentLight})`,
          color: COLORS.white,
          fontFamily: FONT_HEADING,
          fontWeight: 800,
          fontSize: 64,
          padding: "30px 100px",
          borderRadius: 24,
          boxShadow: `0 20px 60px ${COLORS.accent}66`,
        }}
      >
        {ctaText}
      </div>
      <div
        style={{
          opacity: btnIn,
          fontFamily: FONT_BODY,
          fontSize: 34,
          color: COLORS.muted,
        }}
      >
        RAFD Digital — منصة التقييم الذكي
      </div>
    </AbsoluteFill>
  );
};
