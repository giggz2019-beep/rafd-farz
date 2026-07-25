import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { COLORS } from "./theme";

// Navy canvas with two slow-drifting brand-colored glows
export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const driftX = interpolate(frame, [0, 720], [0, 120]);
  const driftY = interpolate(frame, [0, 720], [0, -80]);

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, ${COLORS.primary} 0%, ${COLORS.primaryLight} 100%)`,
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 1100,
          height: 1100,
          borderRadius: "50%",
          left: -300 + driftX,
          top: -400 + driftY,
          background: `radial-gradient(circle, ${COLORS.accent}55 0%, transparent 65%)`,
          filter: "blur(40px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 900,
          height: 900,
          borderRadius: "50%",
          right: -250 - driftX * 0.5,
          bottom: -350 - driftY,
          background: `radial-gradient(circle, ${COLORS.gold}40 0%, transparent 65%)`,
          filter: "blur(40px)",
        }}
      />
    </AbsoluteFill>
  );
};
