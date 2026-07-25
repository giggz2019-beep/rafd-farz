import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT_HEADING } from "./theme";

export const LogoIntro: React.FC<{ badgeText: string }> = ({ badgeText }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const cardIn = spring({ frame, fps, config: { damping: 14, mass: 0.8 } });
  const badgeIn = spring({ frame: frame - 20, fps, config: { damping: 100 } });
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
        opacity: fadeOut,
        flexDirection: "column",
        gap: 48,
      }}
    >
      <div
        style={{
          background: COLORS.white,
          borderRadius: 40,
          padding: "40px 90px",
          transform: `scale(${cardIn})`,
          boxShadow: "0 30px 90px rgba(0,0,0,.45)",
        }}
      >
        <Img
          src={staticFile("rafd-logo.png")}
          style={{ width: 640, display: "block" }}
        />
      </div>
      <div
        style={{
          opacity: badgeIn,
          transform: `translateY(${(1 - badgeIn) * 30}px)`,
          fontFamily: FONT_HEADING,
          fontWeight: 700,
          fontSize: 42,
          color: COLORS.goldLight,
          border: `2px solid ${COLORS.gold}80`,
          borderRadius: 999,
          padding: "14px 44px",
          direction: "rtl",
        }}
      >
        {badgeText}
      </div>
    </AbsoluteFill>
  );
};
