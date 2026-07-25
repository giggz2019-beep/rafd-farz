import "./index.css";
import { Composition } from "remotion";
import {
  RAFD_PROMO_DURATION,
  RafdPromo,
  rafdPromoSchema,
} from "./RafdPromo";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      // npx remotion render RafdPromo
      id="RafdPromo"
      component={RafdPromo}
      durationInFrames={RAFD_PROMO_DURATION}
      fps={30}
      width={1920}
      height={1080}
      schema={rafdPromoSchema}
      defaultProps={{
        badgeText: "محرك تقييم بالذكاء الاصطناعي",
        description:
          "منصة تُمكّن جميع الجهات الحكومية والخاصة وغير الربحية من أتمتة قرارات القبول والرفض وترتيب الأفضليات للمتقدمين بدقة واحترافية عالية — بناءً على معاييرها الخاصة، بدون تحيّز، وفي دقائق معدودة.",
        ctaText: "جرّب النظام الآن",
      }}
    />
  );
};
