# Deploy to Vercel — Step-by-step

Get a public URL for the Financial Modeler (e.g. `https://financial-modeler-xxx.vercel.app`) so you can open it from any device.

---

## 1. Create a Vercel account (if you don’t have one)

- Go to **https://vercel.com**
- Click **Sign Up**
- Choose **Continue with GitHub** and sign in with the same GitHub account that has the `financial-modeler` repo

---

## 2. Import your project from GitHub

- On Vercel’s dashboard, click **Add New…** → **Project**
- You’ll see a list of your GitHub repos. Find **financial-modeler** (or `jlrojmor/financial-modeler`)
- Click **Import** next to it

---

## 3. Configure the project (usually leave defaults)

- **Project Name:** e.g. `financial-modeler` (you can change it)
- **Framework Preset:** should be **Next.js** (auto-detected)
- **Root Directory:** leave blank (repo root)
- **Build Command:** leave default (`next build` or empty)
- **Output Directory:** leave default
- **Install Command:** leave default (`npm install` or `yarn install`)

Click **Deploy**.

---

## 4. Wait for the build

- Vercel will clone the repo, run `npm install` and `npm run build`, then deploy.
- This usually takes 1–2 minutes.
- When it’s done you’ll see **Congratulations!** and a **Visit** button.

---

## 5. Open your app with the new URL

- Click **Visit** (or open the URL shown, e.g. `https://financial-modeler-xxxx.vercel.app`).
- That URL is your **live app**. You can use it from another computer, phone, or share it.
- **Bookmark it** — it stays the same for this project.

---

## 6. (Optional) Use a custom domain

- In the Vercel project, go to **Settings** → **Domains**
- Add a domain you own (e.g. `app.yourdomain.com`) and follow the DNS instructions Vercel gives you.

---

## After the first deploy: automatic updates

- Whenever you **push to the `main` branch** on GitHub, Vercel will automatically rebuild and update the same URL.
- No need to redeploy manually unless you want to.

---

## If something goes wrong

- **Build fails:** Check the **Build Logs** on the Vercel project page. Common fixes: run `npm run build` locally and fix any errors; ensure **Node.js Version** in Vercel is 18 or 20 (Project Settings → General).
- **App works locally but not on Vercel:** Check that you’re not relying on local-only env vars or files; add any needed env vars in Vercel under **Settings** → **Environment Variables**.
