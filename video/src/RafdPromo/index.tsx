import { AbsoluteFill, Sequence } from "remotion";
import { z } from "zod";
import { Background } from "./Background";
import { Cta } from "./Cta";
import { Features } from "./Features";
import { Headline } from "./Headline";
import { LogoIntro } from "./LogoIntro";

export const rafdPromoSchema = z.object({
  badgeText: z.string(),
  description: z.string(),
  ctaText: z.string(),
});

export const RAFD_PROMO_DURATION = 720; // 24s @ 30fps

// Scene timeline (frames): intro 0-120, headline 120-300,
// features 300-540, CTA 540-720
export const RafdPromo: React.FC<z.infer<typeof rafdPromoSchema>> = ({
  badgeText,
  description,
  ctaText,
}) => {
  return (
    <AbsoluteFill>
      <Background />
      <Sequence durationInFrames={120}>
        <LogoIntro badgeText={badgeText} />
      </Sequence>
      <Sequence from={120} durationInFrames={180}>
        <Headline description={description} />
      </Sequence>
      <Sequence from={300} durationInFrames={240}>
        <Features />
      </Sequence>
      <Sequence from={540} durationInFrames={180}>
        <Cta ctaText={ctaText} />
      </Sequence>
    </AbsoluteFill>
  );
};
