# نشر لاندينج شاد على الـ VPS

الهدف: `https://shadmanagement.co/shad-app/` للصفحة، و `https://shadmanagement.co/shad-app/admin/` للوحة التحكم. الداشبورد والباك إند ما بيتغيّروا خالص.

كل الأوامر على السيرفر (`srv1930654`) إلا لو مكتوب غير كده. نفّذهم بالترتيب.

## 0. قبل ما تبدأ

- الريبو: `https://github.com/Ahmed123sa/shadapp-landing.git` (الفرع `main`).
- محتاج Node 20 أو أحدث. الداشبورد شغّال على Next 16، فهو موجود أصلًا. اتأكد: `node --version`.
- اللوحة بتسمع على `127.0.0.1:3100` بس. مش بتتفتح من بره غير عن طريق nginx.

## 1. الكود

```bash
cd /var/www
git clone https://github.com/Ahmed123sa/shadapp-landing.git shad-app
cd shad-app
node --version
```

لو الريبو private وطلب باسورد، استخدم نفس طريقة الـ pull اللي بتستخدمها للداشبورد.

## 2. إعدادات اللوحة (ملف `.env`)

```bash
cp .env.example .env
nano .env
```

املا:

- `ADMIN_EMAIL`: الإيميل اللي هتدخل بيه اللوحة.
- `ADMIN_PASSWORD_HASH`: ناتج الأمر ده (اكتب باسورد من 10 حروف على الأقل بين العلامتين):

```bash
node admin/hash-password.mjs "الباسورد-هنا"
```
انسخ السطر كله (`ADMIN_PASSWORD_HASH=scrypt$...`) في الـ `.env`.

- `SESSION_SECRET`: ناتج الأمر ده:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- غيّر السطرين دول في `.env` (على السيرفر بس): `TRUST_PROXY=1` و `SERVE_SITE=0`. سيب `PORT=3100`.

بعدها:

```bash
chmod 600 .env
```

## 3. أول بناء للصفحة

```bash
node tools/render.mjs
mkdir -p public
ln -sfn /var/www/shad-app/site /var/www/shad-app/public/shad-app
ls -l public/
```

لازم تشوف `public/shad-app -> /var/www/shad-app/site`. الـ `public/` ده للـ nginx بس، ومش بيتحفظ في git.

## 4. تشغيل اللوحة بـ pm2

```bash
cd /var/www/shad-app
pm2 start admin/server.mjs --name shad-app-landing
pm2 save
pm2 status
curl -s http://127.0.0.1:3100/healthz
```

لازم يرجّع `ok`. لو ما اشتغلش: `pm2 logs shad-app-landing --lines 30`. أشهر سبب إن ناقص حاجة في `.env`، والرسالة بتقول إيه هو.

## 5. nginx

افتح ملف الموقع بتاع `shadmanagement.co`:

```bash
ls /etc/nginx/sites-enabled/
sudo nano /etc/nginx/sites-enabled/<اسم-ملف-الموقع>
```

جوه بلوك `server { ... }` اللي فيه `listen 443 ssl` بتاع `shadmanagement.co`، **قبل** بلوك `location / {`، حط:

```nginx
    # ---- Shad app landing: /shad-app/ ----
    location = /shad-app { return 301 /shad-app/; }
    location = /shad-app/admin { return 301 /shad-app/admin/; }

    location ^~ /shad-app/admin/ {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 1m;
    }
    location ^~ /shad-app/api/ {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 1m;
    }
    location ^~ /shad-app/preview/ {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = /shad-app/ {
        root /var/www/shad-app/public;
        try_files /shad-app/index.html =404;
        add_header Cache-Control "no-cache";
    }
    location ^~ /shad-app/ {
        root /var/www/shad-app/public;
        try_files $uri =404;
        add_header Cache-Control "public, max-age=3600";
    }
    # ---- end Shad app landing ----
```

ما تغيّرش أي حاجة تانية في الملف. بعدين:

```bash
sudo nginx -t
```

لو قال `syntax is ok` و `test is successful`:

```bash
sudo systemctl reload nginx
```

(`reload` مش `restart`، فمفيش انقطاع للداشبورد.)

## 6. اختبار

```bash
curl -sI https://shadmanagement.co/shad-app/ | head -5
curl -sI https://shadmanagement.co/shad-app | head -3
curl -s https://shadmanagement.co/shad-app/api/me
curl -sI https://shadmanagement.co/login | head -3
```

- الأولى: `200`.
- التانية: `301` على `/shad-app/`.
- التالتة: `{"error":"سجّل الدخول"}` (ده معناه إن اللوحة شغالة ومحمية).
- الرابعة: `200`، يعني الداشبورد لسه شغال زي ما هو.

بعدها افتح `https://shadmanagement.co/shad-app/` و `https://shadmanagement.co/shad-app/admin/` من المتصفح وادخل.

## 7. التحديث بعد كده

لما أعدّل الكود (التصميم أو اللوحة) وترفعه:

```bash
cd /var/www/shad-app
git pull
node tools/render.mjs
pm2 restart shad-app-landing
```

`render.mjs` بيستخدم المحتوى اللي نشرته من اللوحة، فتعديلاتك ما بتضيعش، وبينسخ الصور اللي الصفحة محتاجاها لـ `site/media/`. صور الصفحة بتتقدم من نفس بلوك `/shad-app/` في nginx، فمفيش إعداد إضافي.

## 8. الباك أب

المحتوى اللي بتنشره من اللوحة في فولدر `data/` (ملف `content.json` ومسودة ونسخ قديمة والصور في `data/media/`) وهو مش في git. ضيف `/var/www/shad-app/data` وملف `/var/www/shad-app/.env` لنظام الباك أب اللي عندك.

## 9. لو نسيت الباسورد

مفيش إيميل لإعادة التعيين. على السيرفر:

```bash
cd /var/www/shad-app
node admin/hash-password.mjs "باسورد-جديد-طويل"
nano .env            # حط السطر الجديد مكان ADMIN_PASSWORD_HASH
rm -f data/admin.json  # لو كنت غيّرت الباسورد من اللوحة قبل كده
pm2 restart shad-app-landing
```

## 10. لو عايز تشيل اللاندينج

امسح بلوك `# ---- Shad app landing` من nginx واعمل `sudo nginx -t && sudo systemctl reload nginx`، وبعدها `pm2 delete shad-app-landing && pm2 save`. الداشبورد ما بيتأثرش.
