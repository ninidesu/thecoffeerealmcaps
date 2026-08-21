# Setup on Another PC

This guide shows how to access, download, run, and update `thecoffeerealmcaps` on another computer.

Repository URL:

`https://github.com/ninidesu/thecoffeerealmcaps.git`

## 1. What you need first

Before downloading the project on another PC, install:

- `Git`
- `Node.js` LTS (recommended: Node 20 or newer)
- `npm` (comes with Node.js)

If the GitHub repository is private, make sure the other PC is signed in to a GitHub account that has access to the repository.

## 2. Choose how to download the project

### Option A: Clone the repository with Git (recommended)

Use this if you want to:

- keep the project updated
- pull new changes later
- push your own changes

Steps:

1. Open `Command Prompt`, `PowerShell`, or `Git Bash`.
2. Go to the folder where you want the project to live.
3. Run:

```bash
git clone https://github.com/ninidesu/thecoffeerealmcaps.git
```

4. Enter the project folder:

```bash
cd thecoffeerealmcaps
```

### Option B: Download ZIP from GitHub

Use this only if you just want a quick copy and do not need Git history.

Steps:

1. Open the repository page on GitHub.
2. Click `Code`.
3. Click `Download ZIP`.
4. Extract the ZIP file.
5. Open the extracted `thecoffeerealmcaps` folder in a terminal.

If you want to keep syncing with the latest repository changes, cloning with Git is the better option.

## 3. Install project dependencies

Inside the project folder, run:

```bash
npm install
```

This downloads the React, Vite, Supabase, and other packages listed in [package.json](package.json).

## 4. Environment setup

For normal local frontend use, this project can already connect to Supabase because the public URL and fallback anon key are built into `src/lib/supabase.js`.

That means a fresh clone can usually run immediately after `npm install`.

Optional:

1. Copy `.env.example` to `.env`
2. Edit the values only if you want to override the built-in public Supabase settings

Example `.env.example` values:

```env
VITE_SUPABASE_URL=https://jhkkocjbamoybdvcvoaa.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-if-you-want-to-override-the-built-in-public-key
```

Important:

- You do not need private backend secrets just to run the frontend locally.
- Private secrets such as service-role keys or email credentials must not be committed to Git.
- Supabase Edge Function secrets are only needed when deploying backend functions.

## 5. Run the project locally

Start the development server:

```bash
npm run dev
```

Then open:

`http://localhost:5173/`

Common routes:

- `/`
- `/login`
- `/portal`
- `/cashier`
- `/staff`
- `/admin`

## 6. Windows note for PowerShell users

On some Windows PCs, PowerShell blocks `npm.ps1` because of the execution policy.

If `npm run dev` fails with a script-policy error, use:

```bash
npm.cmd run dev
```

You can also use:

```bash
npm.cmd install
```

instead of `npm install` if needed.

## 7. How to get the latest updates later

If you cloned with Git, open the project folder and run:

```bash
git pull origin main
```

This downloads the newest changes from the `main` branch.

## 8. How to build the project

To create a production build:

```bash
npm run build
```

To preview the production build locally:

```bash
npm run preview
```

## 9. Troubleshooting

### `git` is not recognized

Git is not installed or not added to `PATH`. Install Git and reopen the terminal.

### `npm` is not recognized

Node.js is not installed correctly. Reinstall Node.js LTS and reopen the terminal.

### Port `5173` is already in use

Close the other app using that port, or let Vite choose another port if prompted.

### `node_modules` is missing or broken

Run:

```bash
npm install
```

again inside the project folder.

### The app opens but some backend actions do not work

The frontend should run locally after install, but some admin or function-based features may still depend on:

- Supabase project configuration
- database schema/migrations
- deployed Edge Functions
- private Supabase secrets

## 10. Recommended quick-start for another PC

If you want the shortest working setup, use these commands:

```bash
git clone https://github.com/ninidesu/thecoffeerealmcaps.git
cd thecoffeerealmcaps
npm install
npm run dev
```

If PowerShell blocks `npm`, use:

```bash
git clone https://github.com/ninidesu/thecoffeerealmcaps.git
cd thecoffeerealmcaps
npm.cmd install
npm.cmd run dev
```
