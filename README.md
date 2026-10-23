# لاندينج بيج تطبيق شاد

صفحة واحدة لعملاء شاد، بالعربي والإنجليزي. هتتنشر على `shadmanagement.co/shad-app/`. المشروع ده مستقل تمامًا عن الداشبورد والباك إند.

## الفكرة

الصفحة بتتولّد من حاجتين منفصلتين:

- **القالب** `template/index.tpl.html`: الشكل والهيكل.
- **المحتوى** `content/content.json`: كل النصوص والروابط والإيميلات والسوشيال.

والأمر `node tools/render.mjs` بيدمجهم ويكتب `site/index.html`. فولدر `site/` هو اللي بيتنشر.

## تشغيلها لوكال

```
node tools/render.mjs
```
وبعدها افتح `site/index.html` بدبل كليك في Chrome أو Edge. مش محتاجة سيرفر ولا إنترنت.

## تعديل المحتوى (لحد ما لوحة التحكم تتعمل)

عدّل `content/content.json` وشغّل `node tools/render.mjs`.

| عايز تغيّر | فين في `content.json` |
|---|---|
| أي نص في الصفحة | `text`. كل نص ليه مفتاح (مثل `hero.01`) وفيه `ar` و `en` |
| عنوان الصفحة ووصفها | `meta` |
| رابط دخول العملاء والفريق، وروابط جوجل بلاي و App Store | `links` |
| إيميل التواصل والدعم | `emails` |
| حسابات السوشيال | `social`، وكل حساب فيه `platform` ومعاه `url` (واتساب `number` بدل `url`) |

- النقطة الحمرا في آخر بعض العناوين مكتوبة `{dot}` أو `{pulse}` جوه النص.
- حساب السوشيال اللي رابطه فاضي بيختفي من الصفحة.
- المنصات المتاحة: facebook و instagram و tiktok و whatsapp و x و youtube و snapchat و telegram و threads و other (معاها `label`). الأيقونات في `tools/platforms.json`.
- الزرار اللي رابطه فاضي (جوجل بلاي مثلًا) بيظهر "قريبًا".

## الألوان والمقاسات

`tokens/design-tokens.json`، وبعدها `node tools/build-theme.mjs`. ما تعدّلش `site/assets/css/tokens.css` بإيدك.

## المسار /shad-app/

كل الملفات في الصفحة بمسارات نسبية (`assets/...`)، فالصفحة بتشتغل على `/shad-app/` وعلى أي مسار تاني. لازم الرابط ينتهي بـ `/`، والسيرفر هو اللي بيحوّل `/shad-app` إلى `/shad-app/`.

## الاختبارات

```
node tools/gate.mjs "G:\coding\Skills\ux-ui-agent-skills\ux-ui-agent-skills"
```
محتاجة `npm install` و `npx playwright install chrome` جوه فولدر الـ kit مرة واحدة.

آخر تشغيل: **21/21** على الصفحة الافتراضية. وبعد إضافة السوشيال اتشغّلت اختبارات التباين والحالات و axe والكيبورد والحجم والحركة و RTL والـ overflow على نسخة فيها خمس حسابات، ونجحت. الاختبارات بتثبت الصحة، مش الذوق.

## الحركة وإمكانية الوصول

- لو الجهاز مفعّل "تقليل الحركة"، مفيش أي حركة. الجزيئات بتبقى صورة ثابتة، وكل المحتوى ظاهر.
- لو مفيش JavaScript، الصفحة بتشتغل كاملة، والشاشات الخمسة بتاعة الرحلة بتظهر تحت بعض.
- لو المتصفح مفيهوش WebGL، الخلفية بتبقى توهّج ثابت.

## ملاحظات

- خط العناوين العربي في دليل البراند هو Tharwat Emara Ruqaa، ومش متاح مفتوح. استخدمت Aref Ruqaa لأنه الأقرب.
- الخطوط كلها رخصة OFL: Archivo و Playfair Display و Tajawal و Aref Ruqaa. أيقونات السوشيال من Simple Icons (CC0)، وأيقونة الرابط العامة من Lucide.
- المكتبات في `site/vendor/`: three.js و GSAP و ScrollTrigger و Lenis.
- الصفحة لسه ما اترفعتش على السيرفر.

## الملفات

```
template/index.tpl.html    الهيكل، فيه {{t:مفتاح}} و {{link:..}} و {{email:..}} و {{social:..}}
content/content.json       المحتوى
tools/render.mjs           يدمج القالب والمحتوى في site/index.html
tools/platforms.json       منصات السوشيال وأيقوناتها
tools/build-theme.mjs      يبني tokens.css
tools/gate.mjs             يشغّل اختبارات الـ kit
tokens/design-tokens.json  مصدر الألوان والمقاسات
site/                      اللي بيتنشر
  index.html               مولَّد، ما تعدّلوش بإيدك
  assets/  vendor/
```
