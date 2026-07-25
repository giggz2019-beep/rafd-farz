import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS, FONT_BODY, FONT_HEADING } from "./theme";

const LINES = ["مرحباً بكم", "في مستقبل التقييم", "الذكي"];

export const Headline: React.FC<{ description: string }> = ({
  description,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const fadeOut = interpolate(
    frame,
    [durationInFrames - 18, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const descIn = spring({ frame: frame - 45, fps, config: { damping: 100 } });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "center",
        alignItems: "center",
        flexDirection: "column",
        opacity: fadeOut,
        direction: "rtl",
        padding: "0 200px",
        textAlign: "center",
      }}
    >
      {LINES.map((line, i) => {
        const progress = spring({
          frame: frame - i * 12,
          fps,
          config: { damping: 16, mass: 0.7 },
        });
        const isGradient = i === 1;
        return (
          <div
            key={line}
            style={{
              fontFamily: FONT_HEADING,
              fontWeight: 800,
              fontSize: 120,
              lineHeight: 1.25,
              opacity: progress,
              transform: `translateY(${(1 - progress) * 60}px)`,
              color: COLORS.white,
              ...(isGradient
                ? {
                    background: `linear-gradient(90deg, ${COLORS.accentLight}, ${COLORS.goldLight})`,
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    color: "transparent",
                  }
                : {}),
            }}
          >
            {line}
          </div>
        );
      })}
      <div
        style={{
          marginTop: 56,
          maxWidth: 1300,
          fontFamily: FONT_BODY,
          fontWeight: 500,
          fontSize: 40,
          lineHeight: 1.8,
          color: COLORS.muted,
          opacity: descIn,
          transform: `translateY(${(1 - descIn) * 40}px)`,
        }}
      >
        {description}
      </div>
    </AbsoluteFill>
  );
};
