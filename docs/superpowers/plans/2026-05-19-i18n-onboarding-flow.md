# LUM-42 · i18n migration for new-user flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded English strings in the three new-user-flow pages (waitlist signup, onboarding, accept-invite) with `react-intl` calls, and synchronise all 16 locale files with proper translations — never English fallbacks.

**Architecture:** Three client pages currently embed English strings inline. We wire `useIntl()` into each page, replace literals with `intl.formatMessage({ id })` (or `<FormattedMessage>` for JSX text), add new keys to `lib/i18n/en.json` as the canonical source, then translate into all 15 non-English locale files. Each page is one self-contained PR-ready commit.

**Tech Stack:** Next.js 14 (App Router), TypeScript, react-intl, 16 flat-namespaced JSON locale files in `lib/i18n/`.

**Scope verification (run before executing):**
- ✅ `ProfilePage.tsx` was already fully migrated (15 `profile.*` keys present in all 16 locales). It is NOT in this plan. `components/LogoUploader.tsx` was added in its place as the fourth file (workspace-settings adjacency, ~8 strings).
- ✅ Locale list resolved: `en, zh-CN, zh-TW, en-GB, en-AU, es, es-419, fr, de, ja, ko, hi, ru, vi, id, ms` (16 total per `lib/i18n/IntlProviderWrapper.tsx`).
- ✅ Locale-file format: flat `"namespace.key": "value"` JSON, no nesting.
- ✅ Component pattern (mirror `ProfilePage.tsx`): `const intl = useIntl()` then `intl.formatMessage({ id: 'key' })`. For text with placeholders: `intl.formatMessage({ id }, { name: value })`. Inside JSX text, `<FormattedMessage id="..." values={{ name: <span>...</span> }} />` for rich content.

---

## File Structure

**Modified files:**
- `app/signup/[[...signup]]/page.tsx` — Add `useIntl()`, replace 21 strings.
- `app/onboarding/page.tsx` — Add `useIntl()` in both `WorkspaceStep` and `InviteStep`, replace 17 strings.
- `app/invite/[token]/AcceptInviteClient.tsx` — Add `useIntl()`, replace 15 strings (1 with `{workspaceName}`, 1 with `{inviterName}` + `{workspaceName}`).
- `components/LogoUploader.tsx` — Add `useIntl()`, replace 8 strings (toast errors, dialog title, save/cancel buttons reuse `common.*`).
- `lib/i18n/en.json` — Add ~61 new keys.
- `lib/i18n/zh-CN.json` — Sync.
- `lib/i18n/zh-TW.json` — Sync.
- `lib/i18n/en-GB.json` — Sync (mirror en).
- `lib/i18n/en-AU.json` — Sync (mirror en).
- `lib/i18n/es.json` — Sync.
- `lib/i18n/es-419.json` — Sync.
- `lib/i18n/fr.json` — Sync.
- `lib/i18n/de.json` — Sync.
- `lib/i18n/ja.json` — Sync.
- `lib/i18n/ko.json` — Sync.
- `lib/i18n/hi.json` — Sync.
- `lib/i18n/ru.json` — Sync.
- `lib/i18n/vi.json` — Sync.
- `lib/i18n/id.json` — Sync.
- `lib/i18n/ms.json` — Sync.

**Key namespaces introduced:**
- `waitlist.*` (21 keys) — signup/waitlist page
- `onboarding.workspace.*` and `onboarding.invite.*` and `onboarding.error.*` (17 keys) — onboarding
- `invite.*` (15 keys) — accept-invite
- `logoUploader.*` (8 keys) — logo uploader component

---

## Task 1: Setup branch

**Files:** none yet — only branch creation.

- [ ] **Step 1: Create a feature branch**

```bash
git checkout main && git pull
git checkout -b lumo/LUM-42-i18n-onboarding-flow
```

- [ ] **Step 2: Confirm baseline compiles**

Run: `npx tsc --noEmit`
Expected: exit code 0, no errors.

---

## Task 2: Migrate waitlist signup page

**Files:**
- Modify: `app/signup/[[...signup]]/page.tsx` (full rewrite shown)
- Modify: `lib/i18n/en.json` — append 21 keys
- Modify: 15 other locale files — append translated 21 keys

- [ ] **Step 1: Add the 21 new keys to `lib/i18n/en.json`**

Append (before closing `}`) — match existing alphabetical-ish grouping, slot under a new `waitlist.*` block:

```json
  "waitlist.heading": "Join the Waitlist",
  "waitlist.subheading": "Get early access to Lumo.",
  "waitlist.success.title": "You're on the list!",
  "waitlist.success.body": "We'll reach out when your spot is ready.",
  "waitlist.field.email": "Work email",
  "waitlist.placeholder.email": "you@company.com",
  "waitlist.field.name": "Name",
  "waitlist.placeholder.name": "Jane Smith",
  "waitlist.field.company": "Company",
  "waitlist.placeholder.company": "Acme Inc.",
  "waitlist.field.teamSize": "Team size",
  "waitlist.teamSize.select": "Select...",
  "waitlist.teamSize.justMe": "Just me",
  "waitlist.teamSize.2to5": "2–5",
  "waitlist.teamSize.6to15": "6–15",
  "waitlist.teamSize.16to50": "16–50",
  "waitlist.teamSize.50plus": "50+",
  "waitlist.button.submit": "Join Waitlist",
  "waitlist.button.submitting": "Submitting...",
  "waitlist.footer": "We'll never share your email. Unsubscribe anytime.",
  "waitlist.error.network": "Network error. Please try again.",
```

- [ ] **Step 2: Replace `app/signup/[[...signup]]/page.tsx` with the i18n-wired version**

```tsx
'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { waitlistClient, ApiClientError } from '@/lib/api-client'

export default function WaitlistPage() {
  const intl = useIntl()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [teamSize, setTeamSize] = useState('')
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'success' | 'error' | 'duplicate'
  >('idle')
  const [message, setMessage] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')

    try {
      const { result, message: msg } = await waitlistClient.join({
        email,
        name,
        company,
        teamSize,
      })
      setStatus(result === 'created' ? 'success' : 'duplicate')
      setMessage(msg)
    } catch (err) {
      setStatus('error')
      setMessage(
        err instanceof ApiClientError
          ? err.message
          : intl.formatMessage({ id: 'waitlist.error.network' })
      )
    }
  }

  return (
    <div className='flex min-h-screen items-center justify-center bg-[#0a0a0b] px-4'>
      <div className='w-full max-w-md'>
        <div className='mb-8 flex items-center justify-center gap-3'>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src='/logo-dark.svg' alt='Lumo' className='h-10 w-auto' />
          <span className='text-3xl font-bold text-white'>Lumo</span>
        </div>

        {status === 'success' ? (
          <div className='rounded-2xl border border-white/10 bg-white/5 p-8 text-center'>
            <div className='mb-4 text-4xl'>🎉</div>
            <h2 className='mb-2 text-xl font-semibold text-white'>
              {intl.formatMessage({ id: 'waitlist.success.title' })}
            </h2>
            <p className='text-sm text-zinc-400'>
              {intl.formatMessage({ id: 'waitlist.success.body' })}
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className='flex flex-col gap-5 rounded-2xl border border-white/10 bg-white/5 p-8'
          >
            <div className='text-center'>
              <h1 className='text-xl font-semibold text-white'>
                {intl.formatMessage({ id: 'waitlist.heading' })}
              </h1>
              <p className='mt-1 text-sm text-zinc-400'>
                {intl.formatMessage({ id: 'waitlist.subheading' })}
              </p>
            </div>

            <div className='flex flex-col gap-1.5'>
              <label
                htmlFor='email'
                className='text-sm font-medium text-zinc-300'
              >
                {intl.formatMessage({ id: 'waitlist.field.email' })}{' '}
                <span className='text-red-400'>*</span>
              </label>
              <input
                id='email'
                type='email'
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={intl.formatMessage({
                  id: 'waitlist.placeholder.email',
                })}
                className='rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-white/25 focus:ring-1 focus:ring-white/25'
              />
            </div>

            <div className='flex flex-col gap-1.5'>
              <label
                htmlFor='name'
                className='text-sm font-medium text-zinc-300'
              >
                {intl.formatMessage({ id: 'waitlist.field.name' })}
              </label>
              <input
                id='name'
                type='text'
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={intl.formatMessage({
                  id: 'waitlist.placeholder.name',
                })}
                className='rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-white/25 focus:ring-1 focus:ring-white/25'
              />
            </div>

            <div className='flex flex-col gap-1.5'>
              <label
                htmlFor='company'
                className='text-sm font-medium text-zinc-300'
              >
                {intl.formatMessage({ id: 'waitlist.field.company' })}
              </label>
              <input
                id='company'
                type='text'
                value={company}
                onChange={e => setCompany(e.target.value)}
                placeholder={intl.formatMessage({
                  id: 'waitlist.placeholder.company',
                })}
                className='rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-white/25 focus:ring-1 focus:ring-white/25'
              />
            </div>

            <div className='flex flex-col gap-1.5'>
              <label
                htmlFor='teamSize'
                className='text-sm font-medium text-zinc-300'
              >
                {intl.formatMessage({ id: 'waitlist.field.teamSize' })}
              </label>
              <select
                id='teamSize'
                value={teamSize}
                onChange={e => setTeamSize(e.target.value)}
                className='rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-white/25 focus:ring-1 focus:ring-white/25'
              >
                <option value='' className='bg-zinc-900'>
                  {intl.formatMessage({ id: 'waitlist.teamSize.select' })}
                </option>
                <option value='1' className='bg-zinc-900'>
                  {intl.formatMessage({ id: 'waitlist.teamSize.justMe' })}
                </option>
                <option value='2-5' className='bg-zinc-900'>
                  {intl.formatMessage({ id: 'waitlist.teamSize.2to5' })}
                </option>
                <option value='6-15' className='bg-zinc-900'>
                  {intl.formatMessage({ id: 'waitlist.teamSize.6to15' })}
                </option>
                <option value='16-50' className='bg-zinc-900'>
                  {intl.formatMessage({ id: 'waitlist.teamSize.16to50' })}
                </option>
                <option value='50+' className='bg-zinc-900'>
                  {intl.formatMessage({ id: 'waitlist.teamSize.50plus' })}
                </option>
              </select>
            </div>

            {(status === 'error' || status === 'duplicate') && (
              <p
                className={`text-sm ${status === 'error' ? 'text-red-400' : 'text-amber-400'}`}
              >
                {message}
              </p>
            )}

            <button
              type='submit'
              disabled={status === 'loading'}
              className='rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50'
            >
              {status === 'loading'
                ? intl.formatMessage({ id: 'waitlist.button.submitting' })
                : intl.formatMessage({ id: 'waitlist.button.submit' })}
            </button>
          </form>
        )}

        <p className='mt-6 text-center text-xs text-zinc-500'>
          {intl.formatMessage({ id: 'waitlist.footer' })}
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Add `waitlist.*` keys to `lib/i18n/zh-CN.json`**

Append before closing `}`:

```json
  "waitlist.heading": "加入候补名单",
  "waitlist.subheading": "抢先体验 Lumo。",
  "waitlist.success.title": "你已加入候补名单！",
  "waitlist.success.body": "席位准备好后我们会联系你。",
  "waitlist.field.email": "工作邮箱",
  "waitlist.placeholder.email": "you@company.com",
  "waitlist.field.name": "姓名",
  "waitlist.placeholder.name": "张三",
  "waitlist.field.company": "公司",
  "waitlist.placeholder.company": "示例公司",
  "waitlist.field.teamSize": "团队规模",
  "waitlist.teamSize.select": "请选择…",
  "waitlist.teamSize.justMe": "仅自己",
  "waitlist.teamSize.2to5": "2–5 人",
  "waitlist.teamSize.6to15": "6–15 人",
  "waitlist.teamSize.16to50": "16–50 人",
  "waitlist.teamSize.50plus": "50 人以上",
  "waitlist.button.submit": "加入候补",
  "waitlist.button.submitting": "提交中…",
  "waitlist.footer": "我们绝不会泄露你的邮箱。可随时退订。",
  "waitlist.error.network": "网络错误，请稍后重试。",
```

- [ ] **Step 4: Add `waitlist.*` keys to `lib/i18n/zh-TW.json`**

```json
  "waitlist.heading": "加入候補名單",
  "waitlist.subheading": "搶先體驗 Lumo。",
  "waitlist.success.title": "你已加入候補名單！",
  "waitlist.success.body": "席次準備好後我們會聯絡你。",
  "waitlist.field.email": "工作信箱",
  "waitlist.placeholder.email": "you@company.com",
  "waitlist.field.name": "姓名",
  "waitlist.placeholder.name": "王小明",
  "waitlist.field.company": "公司",
  "waitlist.placeholder.company": "範例公司",
  "waitlist.field.teamSize": "團隊規模",
  "waitlist.teamSize.select": "請選擇…",
  "waitlist.teamSize.justMe": "只有自己",
  "waitlist.teamSize.2to5": "2–5 人",
  "waitlist.teamSize.6to15": "6–15 人",
  "waitlist.teamSize.16to50": "16–50 人",
  "waitlist.teamSize.50plus": "50 人以上",
  "waitlist.button.submit": "加入候補",
  "waitlist.button.submitting": "提交中…",
  "waitlist.footer": "我們絕不會洩露你的信箱，可隨時取消訂閱。",
  "waitlist.error.network": "網路錯誤，請稍後再試。",
```

- [ ] **Step 5: Add `waitlist.*` keys to `lib/i18n/en-GB.json`**

```json
  "waitlist.heading": "Join the Waitlist",
  "waitlist.subheading": "Get early access to Lumo.",
  "waitlist.success.title": "You're on the list!",
  "waitlist.success.body": "We'll reach out when your spot is ready.",
  "waitlist.field.email": "Work email",
  "waitlist.placeholder.email": "you@company.com",
  "waitlist.field.name": "Name",
  "waitlist.placeholder.name": "Jane Smith",
  "waitlist.field.company": "Company",
  "waitlist.placeholder.company": "Acme Ltd.",
  "waitlist.field.teamSize": "Team size",
  "waitlist.teamSize.select": "Select…",
  "waitlist.teamSize.justMe": "Just me",
  "waitlist.teamSize.2to5": "2–5",
  "waitlist.teamSize.6to15": "6–15",
  "waitlist.teamSize.16to50": "16–50",
  "waitlist.teamSize.50plus": "50+",
  "waitlist.button.submit": "Join Waitlist",
  "waitlist.button.submitting": "Submitting…",
  "waitlist.footer": "We'll never share your email. Unsubscribe at any time.",
  "waitlist.error.network": "Network error. Please try again.",
```

- [ ] **Step 6: Add `waitlist.*` keys to `lib/i18n/en-AU.json`**

Same as `en-GB.json` block above (Australian English uses the same orthography as British for these strings).

- [ ] **Step 7: Add `waitlist.*` keys to `lib/i18n/es.json`** (Spain)

```json
  "waitlist.heading": "Únete a la lista de espera",
  "waitlist.subheading": "Obtén acceso anticipado a Lumo.",
  "waitlist.success.title": "¡Estás en la lista!",
  "waitlist.success.body": "Te avisaremos cuando tu plaza esté lista.",
  "waitlist.field.email": "Correo profesional",
  "waitlist.placeholder.email": "tu@empresa.com",
  "waitlist.field.name": "Nombre",
  "waitlist.placeholder.name": "Juan Pérez",
  "waitlist.field.company": "Empresa",
  "waitlist.placeholder.company": "Acme S.L.",
  "waitlist.field.teamSize": "Tamaño del equipo",
  "waitlist.teamSize.select": "Selecciona…",
  "waitlist.teamSize.justMe": "Solo yo",
  "waitlist.teamSize.2to5": "2–5",
  "waitlist.teamSize.6to15": "6–15",
  "waitlist.teamSize.16to50": "16–50",
  "waitlist.teamSize.50plus": "Más de 50",
  "waitlist.button.submit": "Unirme a la lista",
  "waitlist.button.submitting": "Enviando…",
  "waitlist.footer": "Nunca compartiremos tu correo. Puedes darte de baja en cualquier momento.",
  "waitlist.error.network": "Error de red. Inténtalo de nuevo.",
```

- [ ] **Step 8: Add `waitlist.*` keys to `lib/i18n/es-419.json`** (Latin America)

```json
  "waitlist.heading": "Únete a la lista de espera",
  "waitlist.subheading": "Obtén acceso anticipado a Lumo.",
  "waitlist.success.title": "¡Estás en la lista!",
  "waitlist.success.body": "Te avisaremos cuando tu lugar esté listo.",
  "waitlist.field.email": "Correo de trabajo",
  "waitlist.placeholder.email": "tu@empresa.com",
  "waitlist.field.name": "Nombre",
  "waitlist.placeholder.name": "Juan Pérez",
  "waitlist.field.company": "Empresa",
  "waitlist.placeholder.company": "Acme S.A.",
  "waitlist.field.teamSize": "Tamaño del equipo",
  "waitlist.teamSize.select": "Selecciona…",
  "waitlist.teamSize.justMe": "Solo yo",
  "waitlist.teamSize.2to5": "2–5",
  "waitlist.teamSize.6to15": "6–15",
  "waitlist.teamSize.16to50": "16–50",
  "waitlist.teamSize.50plus": "Más de 50",
  "waitlist.button.submit": "Unirme a la lista",
  "waitlist.button.submitting": "Enviando…",
  "waitlist.footer": "Nunca compartiremos tu correo. Puedes cancelar la suscripción cuando quieras.",
  "waitlist.error.network": "Error de red. Inténtalo de nuevo.",
```

- [ ] **Step 9: Add `waitlist.*` keys to `lib/i18n/fr.json`**

```json
  "waitlist.heading": "Rejoindre la liste d'attente",
  "waitlist.subheading": "Obtenez un accès anticipé à Lumo.",
  "waitlist.success.title": "Vous êtes sur la liste !",
  "waitlist.success.body": "Nous vous contacterons dès que votre place sera prête.",
  "waitlist.field.email": "E-mail professionnel",
  "waitlist.placeholder.email": "vous@entreprise.com",
  "waitlist.field.name": "Nom",
  "waitlist.placeholder.name": "Jean Dupont",
  "waitlist.field.company": "Entreprise",
  "waitlist.placeholder.company": "Acme SARL",
  "waitlist.field.teamSize": "Taille de l'équipe",
  "waitlist.teamSize.select": "Sélectionner…",
  "waitlist.teamSize.justMe": "Juste moi",
  "waitlist.teamSize.2to5": "2–5",
  "waitlist.teamSize.6to15": "6–15",
  "waitlist.teamSize.16to50": "16–50",
  "waitlist.teamSize.50plus": "50 et plus",
  "waitlist.button.submit": "Rejoindre la liste",
  "waitlist.button.submitting": "Envoi…",
  "waitlist.footer": "Nous ne partagerons jamais votre e-mail. Désinscription à tout moment.",
  "waitlist.error.network": "Erreur réseau. Veuillez réessayer.",
```

- [ ] **Step 10: Add `waitlist.*` keys to `lib/i18n/de.json`**

```json
  "waitlist.heading": "Auf die Warteliste setzen",
  "waitlist.subheading": "Frühzeitig auf Lumo zugreifen.",
  "waitlist.success.title": "Sie sind auf der Liste!",
  "waitlist.success.body": "Wir melden uns, sobald Ihr Platz bereit ist.",
  "waitlist.field.email": "Geschäftliche E-Mail",
  "waitlist.placeholder.email": "sie@firma.com",
  "waitlist.field.name": "Name",
  "waitlist.placeholder.name": "Max Mustermann",
  "waitlist.field.company": "Unternehmen",
  "waitlist.placeholder.company": "Acme GmbH",
  "waitlist.field.teamSize": "Teamgröße",
  "waitlist.teamSize.select": "Auswählen…",
  "waitlist.teamSize.justMe": "Nur ich",
  "waitlist.teamSize.2to5": "2–5",
  "waitlist.teamSize.6to15": "6–15",
  "waitlist.teamSize.16to50": "16–50",
  "waitlist.teamSize.50plus": "Mehr als 50",
  "waitlist.button.submit": "Auf Warteliste setzen",
  "waitlist.button.submitting": "Wird gesendet…",
  "waitlist.footer": "Wir geben Ihre E-Mail nie weiter. Jederzeit abbestellbar.",
  "waitlist.error.network": "Netzwerkfehler. Bitte erneut versuchen.",
```

- [ ] **Step 11: Add `waitlist.*` keys to `lib/i18n/ja.json`**

```json
  "waitlist.heading": "ウェイトリストに登録",
  "waitlist.subheading": "Lumo にいち早くアクセス。",
  "waitlist.success.title": "ウェイトリストに登録されました！",
  "waitlist.success.body": "席のご案内が出来次第ご連絡します。",
  "waitlist.field.email": "仕事用メールアドレス",
  "waitlist.placeholder.email": "you@company.com",
  "waitlist.field.name": "名前",
  "waitlist.placeholder.name": "山田 太郎",
  "waitlist.field.company": "会社名",
  "waitlist.placeholder.company": "株式会社サンプル",
  "waitlist.field.teamSize": "チーム規模",
  "waitlist.teamSize.select": "選択…",
  "waitlist.teamSize.justMe": "自分のみ",
  "waitlist.teamSize.2to5": "2〜5 人",
  "waitlist.teamSize.6to15": "6〜15 人",
  "waitlist.teamSize.16to50": "16〜50 人",
  "waitlist.teamSize.50plus": "50 人以上",
  "waitlist.button.submit": "ウェイトリストに登録",
  "waitlist.button.submitting": "送信中…",
  "waitlist.footer": "メールアドレスを共有することは一切ありません。いつでも配信解除できます。",
  "waitlist.error.network": "ネットワークエラーが発生しました。もう一度お試しください。",
```

- [ ] **Step 12: Add `waitlist.*` keys to `lib/i18n/ko.json`**

```json
  "waitlist.heading": "대기 목록 신청",
  "waitlist.subheading": "Lumo를 가장 먼저 만나보세요.",
  "waitlist.success.title": "대기 목록에 등록되었습니다!",
  "waitlist.success.body": "자리가 준비되면 알려드리겠습니다.",
  "waitlist.field.email": "업무용 이메일",
  "waitlist.placeholder.email": "you@company.com",
  "waitlist.field.name": "이름",
  "waitlist.placeholder.name": "홍길동",
  "waitlist.field.company": "회사",
  "waitlist.placeholder.company": "예시 주식회사",
  "waitlist.field.teamSize": "팀 규모",
  "waitlist.teamSize.select": "선택…",
  "waitlist.teamSize.justMe": "나 혼자",
  "waitlist.teamSize.2to5": "2–5 명",
  "waitlist.teamSize.6to15": "6–15 명",
  "waitlist.teamSize.16to50": "16–50 명",
  "waitlist.teamSize.50plus": "50명 이상",
  "waitlist.button.submit": "대기 목록 신청",
  "waitlist.button.submitting": "전송 중…",
  "waitlist.footer": "이메일은 절대 공유하지 않습니다. 언제든지 구독을 취소할 수 있습니다.",
  "waitlist.error.network": "네트워크 오류가 발생했습니다. 다시 시도해 주세요.",
```

- [ ] **Step 13: Add `waitlist.*` keys to `lib/i18n/hi.json`**

```json
  "waitlist.heading": "प्रतीक्षा सूची में शामिल हों",
  "waitlist.subheading": "Lumo तक जल्द पहुँच पाएं।",
  "waitlist.success.title": "आप सूची में हैं!",
  "waitlist.success.body": "आपकी जगह तैयार होने पर हम संपर्क करेंगे।",
  "waitlist.field.email": "कार्य ईमेल",
  "waitlist.placeholder.email": "you@company.com",
  "waitlist.field.name": "नाम",
  "waitlist.placeholder.name": "अमित शर्मा",
  "waitlist.field.company": "कंपनी",
  "waitlist.placeholder.company": "Acme प्रा. लि.",
  "waitlist.field.teamSize": "टीम का आकार",
  "waitlist.teamSize.select": "चुनें…",
  "waitlist.teamSize.justMe": "केवल मैं",
  "waitlist.teamSize.2to5": "2–5",
  "waitlist.teamSize.6to15": "6–15",
  "waitlist.teamSize.16to50": "16–50",
  "waitlist.teamSize.50plus": "50 से अधिक",
  "waitlist.button.submit": "सूची में शामिल हों",
  "waitlist.button.submitting": "भेजा जा रहा है…",
  "waitlist.footer": "हम आपका ईमेल कभी साझा नहीं करेंगे। आप कभी भी सदस्यता छोड़ सकते हैं।",
  "waitlist.error.network": "नेटवर्क त्रुटि। कृपया पुनः प्रयास करें।",
```

- [ ] **Step 14: Add `waitlist.*` keys to `lib/i18n/ru.json`**

```json
  "waitlist.heading": "Записаться в лист ожидания",
  "waitlist.subheading": "Получите ранний доступ к Lumo.",
  "waitlist.success.title": "Вы в списке ожидания!",
  "waitlist.success.body": "Мы свяжемся с вами, как только место будет готово.",
  "waitlist.field.email": "Рабочая почта",
  "waitlist.placeholder.email": "you@company.com",
  "waitlist.field.name": "Имя",
  "waitlist.placeholder.name": "Иван Иванов",
  "waitlist.field.company": "Компания",
  "waitlist.placeholder.company": "ООО «Пример»",
  "waitlist.field.teamSize": "Размер команды",
  "waitlist.teamSize.select": "Выберите…",
  "waitlist.teamSize.justMe": "Только я",
  "waitlist.teamSize.2to5": "2–5",
  "waitlist.teamSize.6to15": "6–15",
  "waitlist.teamSize.16to50": "16–50",
  "waitlist.teamSize.50plus": "более 50",
  "waitlist.button.submit": "Записаться",
  "waitlist.button.submitting": "Отправка…",
  "waitlist.footer": "Мы никогда не передадим вашу почту третьим лицам. Отписаться можно в любой момент.",
  "waitlist.error.network": "Ошибка сети. Попробуйте снова.",
```

- [ ] **Step 15: Add `waitlist.*` keys to `lib/i18n/vi.json`**

```json
  "waitlist.heading": "Tham gia danh sách chờ",
  "waitlist.subheading": "Trải nghiệm sớm Lumo.",
  "waitlist.success.title": "Bạn đã có trong danh sách!",
  "waitlist.success.body": "Chúng tôi sẽ liên hệ khi suất của bạn sẵn sàng.",
  "waitlist.field.email": "Email công việc",
  "waitlist.placeholder.email": "ban@congty.com",
  "waitlist.field.name": "Họ và tên",
  "waitlist.placeholder.name": "Nguyễn Văn A",
  "waitlist.field.company": "Công ty",
  "waitlist.placeholder.company": "Công ty Acme",
  "waitlist.field.teamSize": "Quy mô đội ngũ",
  "waitlist.teamSize.select": "Chọn…",
  "waitlist.teamSize.justMe": "Chỉ mình tôi",
  "waitlist.teamSize.2to5": "2–5",
  "waitlist.teamSize.6to15": "6–15",
  "waitlist.teamSize.16to50": "16–50",
  "waitlist.teamSize.50plus": "Trên 50",
  "waitlist.button.submit": "Tham gia danh sách chờ",
  "waitlist.button.submitting": "Đang gửi…",
  "waitlist.footer": "Chúng tôi sẽ không bao giờ chia sẻ email của bạn. Có thể hủy đăng ký bất cứ lúc nào.",
  "waitlist.error.network": "Lỗi kết nối. Vui lòng thử lại.",
```

- [ ] **Step 16: Add `waitlist.*` keys to `lib/i18n/id.json`**

```json
  "waitlist.heading": "Bergabung ke Daftar Tunggu",
  "waitlist.subheading": "Akses awal ke Lumo.",
  "waitlist.success.title": "Anda sudah ada dalam daftar!",
  "waitlist.success.body": "Kami akan menghubungi Anda saat slot Anda siap.",
  "waitlist.field.email": "Email kerja",
  "waitlist.placeholder.email": "anda@perusahaan.com",
  "waitlist.field.name": "Nama",
  "waitlist.placeholder.name": "Budi Santoso",
  "waitlist.field.company": "Perusahaan",
  "waitlist.placeholder.company": "Acme Tbk.",
  "waitlist.field.teamSize": "Ukuran tim",
  "waitlist.teamSize.select": "Pilih…",
  "waitlist.teamSize.justMe": "Hanya saya",
  "waitlist.teamSize.2to5": "2–5",
  "waitlist.teamSize.6to15": "6–15",
  "waitlist.teamSize.16to50": "16–50",
  "waitlist.teamSize.50plus": "Lebih dari 50",
  "waitlist.button.submit": "Gabung Daftar Tunggu",
  "waitlist.button.submitting": "Mengirim…",
  "waitlist.footer": "Kami tidak akan pernah membagikan email Anda. Berhenti berlangganan kapan saja.",
  "waitlist.error.network": "Kesalahan jaringan. Silakan coba lagi.",
```

- [ ] **Step 17: Add `waitlist.*` keys to `lib/i18n/ms.json`**

```json
  "waitlist.heading": "Sertai Senarai Menunggu",
  "waitlist.subheading": "Akses awal ke Lumo.",
  "waitlist.success.title": "Anda kini dalam senarai!",
  "waitlist.success.body": "Kami akan hubungi anda apabila tempat anda sedia.",
  "waitlist.field.email": "E-mel kerja",
  "waitlist.placeholder.email": "anda@syarikat.com",
  "waitlist.field.name": "Nama",
  "waitlist.placeholder.name": "Ahmad bin Ali",
  "waitlist.field.company": "Syarikat",
  "waitlist.placeholder.company": "Acme Sdn. Bhd.",
  "waitlist.field.teamSize": "Saiz pasukan",
  "waitlist.teamSize.select": "Pilih…",
  "waitlist.teamSize.justMe": "Hanya saya",
  "waitlist.teamSize.2to5": "2–5",
  "waitlist.teamSize.6to15": "6–15",
  "waitlist.teamSize.16to50": "16–50",
  "waitlist.teamSize.50plus": "Lebih 50",
  "waitlist.button.submit": "Sertai Senarai Menunggu",
  "waitlist.button.submitting": "Menghantar…",
  "waitlist.footer": "Kami tidak akan kongsikan e-mel anda. Berhenti melanggan bila-bila masa.",
  "waitlist.error.network": "Ralat rangkaian. Sila cuba lagi.",
```

- [ ] **Step 18: Verify all locale files still parse as valid JSON**

Run:
```bash
for f in lib/i18n/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "OK $f" || echo "BROKEN $f"; done
```
Expected: all 16 lines say `OK`.

- [ ] **Step 19: Type check**

Run: `npx tsc --noEmit`
Expected: exit code 0.

- [ ] **Step 20: Visual smoke test**

Run the dev server (`preview_start`) and load `/signup`. Confirm:
- Heading reads "Join the Waitlist" in `en`, "加入候补名单" in `zh-CN`.
- All form labels and placeholders render.
- Submit the form with bad input → error toast appears (network error fallback).
- Switch locale (if accessible via UI) and confirm strings update.

If you cannot test via preview, say so explicitly — do not claim success.

- [ ] **Step 21: Commit**

```bash
git add app/signup/[[...signup]]/page.tsx lib/i18n/*.json
git commit -m "feat: i18n waitlist signup page [LUM-42]"
```

---

## Task 3: Migrate onboarding page

**Files:**
- Modify: `app/onboarding/page.tsx` (full rewrite shown)
- Modify: all 16 `lib/i18n/*.json` — append 17 keys

- [ ] **Step 1: Add 17 keys to `lib/i18n/en.json`**

```json
  "onboarding.workspace.title": "Create your workspace",
  "onboarding.workspace.nameLabel": "Workspace name",
  "onboarding.workspace.namePlaceholder": "Acme Inc.",
  "onboarding.workspace.urlLabel": "Workspace URL",
  "onboarding.workspace.urlPlaceholder": "acme-inc",
  "onboarding.workspace.creating": "Creating…",
  "onboarding.workspace.continue": "Continue",
  "onboarding.workspace.error.create": "Failed to create workspace",
  "onboarding.invite.title": "Invite your team",
  "onboarding.invite.subtitle": "Get your team up and running faster",
  "onboarding.invite.emailPlaceholder": "teammate@company.com",
  "onboarding.invite.addAnother": "Add another",
  "onboarding.invite.sending": "Sending…",
  "onboarding.invite.send": "Send invites",
  "onboarding.invite.skip": "Skip for now",
  "onboarding.invite.error.send": "Failed to send invites",
  "onboarding.error.generic": "Something went wrong",
```

- [ ] **Step 2: Replace `app/onboarding/page.tsx` — wire `useIntl` into both sub-components**

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useIntl } from 'react-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import Image from 'next/image'
import { generateWorkspaceSlug } from '@/lib/workspace/slug'
import { Plus, X } from 'lucide-react'

function WorkspaceStep({
  onCreated,
}: {
  onCreated: (workspaceId: string, slug: string) => void
}) {
  const intl = useIntl()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleNameChange = (value: string) => {
    setName(value)
    if (!slugEdited) setSlug(generateWorkspaceSlug(value))
  }

  const handleSlugChange = (value: string) => {
    setSlug(
      value
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .replace(/^-+/, '')
    )
    setSlugEdited(true)
  }

  const handleSubmit = async () => {
    if (!name.trim() || !slug.trim()) return
    setIsSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), slug }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(
          data.error ||
            intl.formatMessage({ id: 'onboarding.workspace.error.create' })
        )
        return
      }
      onCreated(data.workspace.id, data.workspace.slug)
    } catch {
      setError(intl.formatMessage({ id: 'onboarding.error.generic' }))
    } finally {
      setIsSubmitting(false)
    }
  }

  const isValid = name.trim().length >= 2 && slug.length >= 2

  return (
    <Card className='w-full max-w-md shadow-xl'>
      <CardHeader className='text-center space-y-6'>
        <div className='flex justify-center'>
          <Image
            src='/logo-dark.svg'
            alt='Lumo Logo'
            width={62}
            height={62}
            className='h-[62px] w-[62px]'
            priority
          />
        </div>
        <CardTitle className='text-sm font-normal text-slate-900'>
          {intl.formatMessage({ id: 'onboarding.workspace.title' })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className='space-y-4'>
          <div className='space-y-1.5'>
            <Label htmlFor='ws-name' className='text-xs text-slate-500'>
              {intl.formatMessage({ id: 'onboarding.workspace.nameLabel' })}
            </Label>
            <Input
              id='ws-name'
              type='text'
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              placeholder={intl.formatMessage({
                id: 'onboarding.workspace.namePlaceholder',
              })}
              disabled={isSubmitting}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
          </div>
          <div className='space-y-1.5'>
            <Label htmlFor='ws-url' className='text-xs text-slate-500'>
              {intl.formatMessage({ id: 'onboarding.workspace.urlLabel' })}
            </Label>
            <div className='flex items-center border border-input rounded-md focus-within:ring-2 focus-within:ring-ring overflow-hidden bg-white'>
              <span className='px-3 text-sm text-slate-400 bg-slate-50 border-r border-input h-9 flex items-center shrink-0 select-none'>
                lumo.app/
              </span>
              <input
                id='ws-url'
                type='text'
                value={slug}
                onChange={e => handleSlugChange(e.target.value)}
                placeholder={intl.formatMessage({
                  id: 'onboarding.workspace.urlPlaceholder',
                })}
                disabled={isSubmitting}
                onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                className='flex-1 h-9 px-3 text-sm outline-none bg-transparent'
              />
            </div>
          </div>
          {error && <p className='text-xs text-red-600'>{error}</p>}
          <Button
            type='button'
            disabled={isSubmitting || !isValid}
            onClick={handleSubmit}
            className='w-full h-12 text-base font-normal bg-slate-900 hover:bg-slate-800 text-white'
          >
            {isSubmitting
              ? intl.formatMessage({ id: 'onboarding.workspace.creating' })
              : intl.formatMessage({ id: 'onboarding.workspace.continue' })}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function InviteStep({
  workspaceId,
  workspaceSlug,
}: {
  workspaceId: string
  workspaceSlug: string
}) {
  const intl = useIntl()
  const router = useRouter()
  const [emails, setEmails] = useState<string[]>([''])
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState('')

  const updateEmail = (index: number, value: string) => {
    setEmails(prev => prev.map((e, i) => (i === index ? value : e)))
  }

  const addEmail = () => setEmails(prev => [...prev, ''])

  const removeEmail = (index: number) =>
    setEmails(prev => prev.filter((_, i) => i !== index))

  const validEmails = emails.map(e => e.trim()).filter(e => e.length > 0)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const allValid =
    validEmails.length > 0 && validEmails.every(e => emailRegex.test(e))

  const handleSend = async () => {
    if (!allValid) return
    setIsSending(true)
    setError('')
    try {
      const res = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: validEmails, workspaceId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(
          data.error ||
            intl.formatMessage({ id: 'onboarding.invite.error.send' })
        )
        setIsSending(false)
        return
      }
      router.push(`/workspace/${workspaceSlug}`)
    } catch {
      setError(intl.formatMessage({ id: 'onboarding.error.generic' }))
      setIsSending(false)
    }
  }

  const handleSkip = () => router.push(`/workspace/${workspaceSlug}`)

  return (
    <Card className='w-full max-w-md shadow-xl'>
      <CardHeader className='text-center space-y-6'>
        <div className='flex justify-center'>
          <Image
            src='/logo-dark.svg'
            alt='Lumo Logo'
            width={62}
            height={62}
            className='h-[62px] w-[62px]'
            priority
          />
        </div>
        <div>
          <CardTitle className='text-sm font-normal text-slate-900'>
            {intl.formatMessage({ id: 'onboarding.invite.title' })}
          </CardTitle>
          <p className='text-xs text-slate-400 mt-1'>
            {intl.formatMessage({ id: 'onboarding.invite.subtitle' })}
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <div className='space-y-4'>
          <div className='space-y-2'>
            {emails.map((email, i) => (
              <div key={i} className='flex items-center gap-2'>
                <Input
                  type='email'
                  value={email}
                  onChange={e => updateEmail(i, e.target.value)}
                  placeholder={intl.formatMessage({
                    id: 'onboarding.invite.emailPlaceholder',
                  })}
                  disabled={isSending}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (i === emails.length - 1) addEmail()
                    }
                  }}
                />
                {emails.length > 1 && (
                  <Button
                    variant='ghost'
                    size='icon'
                    className='h-9 w-9 shrink-0 text-slate-400'
                    onClick={() => removeEmail(i)}
                    disabled={isSending}
                  >
                    <X size={14} />
                  </Button>
                )}
              </div>
            ))}
          </div>

          {emails.length < 5 && (
            <button
              onClick={addEmail}
              disabled={isSending}
              className='flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-700 transition-colors'
            >
              <Plus size={12} />
              {intl.formatMessage({ id: 'onboarding.invite.addAnother' })}
            </button>
          )}

          {error && <p className='text-xs text-red-600'>{error}</p>}

          <Button
            disabled={isSending || !allValid}
            onClick={handleSend}
            className='w-full h-12 text-base font-normal bg-slate-900 hover:bg-slate-800 text-white'
          >
            {isSending
              ? intl.formatMessage({ id: 'onboarding.invite.sending' })
              : intl.formatMessage({ id: 'onboarding.invite.send' })}
          </Button>

          <button
            onClick={handleSkip}
            disabled={isSending}
            className='w-full text-center text-xs text-slate-400 hover:text-slate-600 transition-colors py-1'
          >
            {intl.formatMessage({ id: 'onboarding.invite.skip' })}
          </button>
        </div>
      </CardContent>
    </Card>
  )
}

export default function OnboardingPage() {
  const [step, setStep] = useState<'workspace' | 'invite'>('workspace')
  const [workspaceId, setWorkspaceId] = useState('')
  const [workspaceSlug, setWorkspaceSlug] = useState('')

  const handleWorkspaceCreated = (id: string, slug: string) => {
    setWorkspaceId(id)
    setWorkspaceSlug(slug)
    setStep('invite')
  }

  return (
    <div className='min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 py-12 px-4'>
      {step === 'workspace' ? (
        <WorkspaceStep onCreated={handleWorkspaceCreated} />
      ) : (
        <InviteStep workspaceId={workspaceId} workspaceSlug={workspaceSlug} />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Add `onboarding.*` keys to `lib/i18n/zh-CN.json`**

```json
  "onboarding.workspace.title": "创建你的工作区",
  "onboarding.workspace.nameLabel": "工作区名称",
  "onboarding.workspace.namePlaceholder": "示例公司",
  "onboarding.workspace.urlLabel": "工作区网址",
  "onboarding.workspace.urlPlaceholder": "acme-inc",
  "onboarding.workspace.creating": "创建中…",
  "onboarding.workspace.continue": "继续",
  "onboarding.workspace.error.create": "创建工作区失败",
  "onboarding.invite.title": "邀请你的团队",
  "onboarding.invite.subtitle": "让团队更快上手",
  "onboarding.invite.emailPlaceholder": "teammate@company.com",
  "onboarding.invite.addAnother": "添加",
  "onboarding.invite.sending": "发送中…",
  "onboarding.invite.send": "发送邀请",
  "onboarding.invite.skip": "稍后再说",
  "onboarding.invite.error.send": "发送邀请失败",
  "onboarding.error.generic": "出错了",
```

- [ ] **Step 4: Add `onboarding.*` keys to `lib/i18n/zh-TW.json`**

```json
  "onboarding.workspace.title": "建立你的工作區",
  "onboarding.workspace.nameLabel": "工作區名稱",
  "onboarding.workspace.namePlaceholder": "範例公司",
  "onboarding.workspace.urlLabel": "工作區網址",
  "onboarding.workspace.urlPlaceholder": "acme-inc",
  "onboarding.workspace.creating": "建立中…",
  "onboarding.workspace.continue": "繼續",
  "onboarding.workspace.error.create": "建立工作區失敗",
  "onboarding.invite.title": "邀請你的團隊",
  "onboarding.invite.subtitle": "讓團隊更快上手",
  "onboarding.invite.emailPlaceholder": "teammate@company.com",
  "onboarding.invite.addAnother": "新增",
  "onboarding.invite.sending": "傳送中…",
  "onboarding.invite.send": "傳送邀請",
  "onboarding.invite.skip": "稍後再說",
  "onboarding.invite.error.send": "傳送邀請失敗",
  "onboarding.error.generic": "發生錯誤",
```

- [ ] **Step 5: Add `onboarding.*` keys to `lib/i18n/en-GB.json` and `lib/i18n/en-AU.json`**

For both files, append the same block:

```json
  "onboarding.workspace.title": "Create your workspace",
  "onboarding.workspace.nameLabel": "Workspace name",
  "onboarding.workspace.namePlaceholder": "Acme Ltd.",
  "onboarding.workspace.urlLabel": "Workspace URL",
  "onboarding.workspace.urlPlaceholder": "acme-inc",
  "onboarding.workspace.creating": "Creating…",
  "onboarding.workspace.continue": "Continue",
  "onboarding.workspace.error.create": "Failed to create workspace",
  "onboarding.invite.title": "Invite your team",
  "onboarding.invite.subtitle": "Get your team up and running faster",
  "onboarding.invite.emailPlaceholder": "teammate@company.com",
  "onboarding.invite.addAnother": "Add another",
  "onboarding.invite.sending": "Sending…",
  "onboarding.invite.send": "Send invites",
  "onboarding.invite.skip": "Skip for now",
  "onboarding.invite.error.send": "Failed to send invites",
  "onboarding.error.generic": "Something went wrong",
```

- [ ] **Step 6: Add `onboarding.*` keys to `lib/i18n/es.json` and `lib/i18n/es-419.json`**

`es.json` (Spain):
```json
  "onboarding.workspace.title": "Crea tu espacio de trabajo",
  "onboarding.workspace.nameLabel": "Nombre del espacio",
  "onboarding.workspace.namePlaceholder": "Acme S.L.",
  "onboarding.workspace.urlLabel": "URL del espacio",
  "onboarding.workspace.urlPlaceholder": "acme-inc",
  "onboarding.workspace.creating": "Creando…",
  "onboarding.workspace.continue": "Continuar",
  "onboarding.workspace.error.create": "No se pudo crear el espacio",
  "onboarding.invite.title": "Invita a tu equipo",
  "onboarding.invite.subtitle": "Pon a tu equipo en marcha más rápido",
  "onboarding.invite.emailPlaceholder": "companero@empresa.com",
  "onboarding.invite.addAnother": "Añadir otro",
  "onboarding.invite.sending": "Enviando…",
  "onboarding.invite.send": "Enviar invitaciones",
  "onboarding.invite.skip": "Omitir por ahora",
  "onboarding.invite.error.send": "No se pudieron enviar las invitaciones",
  "onboarding.error.generic": "Algo salió mal",
```

`es-419.json` (LatAm): same as above, except:
```json
  "onboarding.workspace.namePlaceholder": "Acme S.A.",
  "onboarding.invite.addAnother": "Agregar otro",
```

- [ ] **Step 7: Add `onboarding.*` keys to `lib/i18n/fr.json`**

```json
  "onboarding.workspace.title": "Créez votre espace de travail",
  "onboarding.workspace.nameLabel": "Nom de l'espace",
  "onboarding.workspace.namePlaceholder": "Acme SARL",
  "onboarding.workspace.urlLabel": "URL de l'espace",
  "onboarding.workspace.urlPlaceholder": "acme-inc",
  "onboarding.workspace.creating": "Création…",
  "onboarding.workspace.continue": "Continuer",
  "onboarding.workspace.error.create": "Impossible de créer l'espace de travail",
  "onboarding.invite.title": "Invitez votre équipe",
  "onboarding.invite.subtitle": "Lancez votre équipe plus vite",
  "onboarding.invite.emailPlaceholder": "collegue@entreprise.com",
  "onboarding.invite.addAnother": "Ajouter un autre",
  "onboarding.invite.sending": "Envoi…",
  "onboarding.invite.send": "Envoyer les invitations",
  "onboarding.invite.skip": "Passer pour l'instant",
  "onboarding.invite.error.send": "Échec de l'envoi des invitations",
  "onboarding.error.generic": "Une erreur s'est produite",
```

- [ ] **Step 8: Add `onboarding.*` keys to `lib/i18n/de.json`**

```json
  "onboarding.workspace.title": "Workspace erstellen",
  "onboarding.workspace.nameLabel": "Workspace-Name",
  "onboarding.workspace.namePlaceholder": "Acme GmbH",
  "onboarding.workspace.urlLabel": "Workspace-URL",
  "onboarding.workspace.urlPlaceholder": "acme-inc",
  "onboarding.workspace.creating": "Wird erstellt…",
  "onboarding.workspace.continue": "Weiter",
  "onboarding.workspace.error.create": "Workspace konnte nicht erstellt werden",
  "onboarding.invite.title": "Team einladen",
  "onboarding.invite.subtitle": "Bringen Sie Ihr Team schneller an den Start",
  "onboarding.invite.emailPlaceholder": "kollege@firma.com",
  "onboarding.invite.addAnother": "Weitere hinzufügen",
  "onboarding.invite.sending": "Wird gesendet…",
  "onboarding.invite.send": "Einladungen senden",
  "onboarding.invite.skip": "Vorerst überspringen",
  "onboarding.invite.error.send": "Einladungen konnten nicht gesendet werden",
  "onboarding.error.generic": "Etwas ist schiefgelaufen",
```

- [ ] **Step 9: Add `onboarding.*` keys to `lib/i18n/ja.json`**

```json
  "onboarding.workspace.title": "ワークスペースを作成",
  "onboarding.workspace.nameLabel": "ワークスペース名",
  "onboarding.workspace.namePlaceholder": "株式会社サンプル",
  "onboarding.workspace.urlLabel": "ワークスペース URL",
  "onboarding.workspace.urlPlaceholder": "acme-inc",
  "onboarding.workspace.creating": "作成中…",
  "onboarding.workspace.continue": "次へ",
  "onboarding.workspace.error.create": "ワークスペースを作成できませんでした",
  "onboarding.invite.title": "チームを招待",
  "onboarding.invite.subtitle": "チーム全員で素早く始めましょう",
  "onboarding.invite.emailPlaceholder": "teammate@company.com",
  "onboarding.invite.addAnother": "追加",
  "onboarding.invite.sending": "送信中…",
  "onboarding.invite.send": "招待を送信",
  "onboarding.invite.skip": "後で",
  "onboarding.invite.error.send": "招待の送信に失敗しました",
  "onboarding.error.generic": "エラーが発生しました",
```

- [ ] **Step 10: Add `onboarding.*` keys to `lib/i18n/ko.json`**

```json
  "onboarding.workspace.title": "워크스페이스 만들기",
  "onboarding.workspace.nameLabel": "워크스페이스 이름",
  "onboarding.workspace.namePlaceholder": "예시 주식회사",
  "onboarding.workspace.urlLabel": "워크스페이스 URL",
  "onboarding.workspace.urlPlaceholder": "acme-inc",
  "onboarding.workspace.creating": "생성 중…",
  "onboarding.workspace.continue": "계속",
  "onboarding.workspace.error.create": "워크스페이스를 만들지 못했습니다",
  "onboarding.invite.title": "팀 초대하기",
  "onboarding.invite.subtitle": "팀과 함께 더 빠르게 시작하세요",
  "onboarding.invite.emailPlaceholder": "동료@회사.com",
  "onboarding.invite.addAnother": "추가",
  "onboarding.invite.sending": "보내는 중…",
  "onboarding.invite.send": "초대 보내기",
  "onboarding.invite.skip": "나중에 하기",
  "onboarding.invite.error.send": "초대 전송에 실패했습니다",
  "onboarding.error.generic": "문제가 발생했습니다",
```

- [ ] **Step 11: Add `onboarding.*` keys to `lib/i18n/hi.json`**

```json
  "onboarding.workspace.title": "अपना वर्कस्पेस बनाएं",
  "onboarding.workspace.nameLabel": "वर्कस्पेस का नाम",
  "onboarding.workspace.namePlaceholder": "Acme प्रा. लि.",
  "onboarding.workspace.urlLabel": "वर्कस्पेस URL",
  "onboarding.workspace.urlPlaceholder": "acme-inc",
  "onboarding.workspace.creating": "बनाया जा रहा है…",
  "onboarding.workspace.continue": "जारी रखें",
  "onboarding.workspace.error.create": "वर्कस्पेस बनाने में विफल",
  "onboarding.invite.title": "अपनी टीम को आमंत्रित करें",
  "onboarding.invite.subtitle": "अपनी टीम को तेज़ी से शुरू कराएं",
  "onboarding.invite.emailPlaceholder": "teammate@company.com",
  "onboarding.invite.addAnother": "और जोड़ें",
  "onboarding.invite.sending": "भेजा जा रहा है…",
  "onboarding.invite.send": "आमंत्रण भेजें",
  "onboarding.invite.skip": "अभी छोड़ें",
  "onboarding.invite.error.send": "आमंत्रण भेजने में विफल",
  "onboarding.error.generic": "कुछ गलत हो गया",
```

- [ ] **Step 12: Add `onboarding.*` keys to `lib/i18n/ru.json`**

```json
  "onboarding.workspace.title": "Создайте рабочее пространство",
  "onboarding.workspace.nameLabel": "Название пространства",
  "onboarding.workspace.namePlaceholder": "ООО «Пример»",
  "onboarding.workspace.urlLabel": "URL пространства",
  "onboarding.workspace.urlPlaceholder": "acme-inc",
  "onboarding.workspace.creating": "Создание…",
  "onboarding.workspace.continue": "Продолжить",
  "onboarding.workspace.error.create": "Не удалось создать рабочее пространство",
  "onboarding.invite.title": "Пригласите команду",
  "onboarding.invite.subtitle": "Поднимите команду на ноги быстрее",
  "onboarding.invite.emailPlaceholder": "kollega@company.com",
  "onboarding.invite.addAnother": "Добавить",
  "onboarding.invite.sending": "Отправка…",
  "onboarding.invite.send": "Отправить приглашения",
  "onboarding.invite.skip": "Пока пропустить",
  "onboarding.invite.error.send": "Не удалось отправить приглашения",
  "onboarding.error.generic": "Что-то пошло не так",
```

- [ ] **Step 13: Add `onboarding.*` keys to `lib/i18n/vi.json`**

```json
  "onboarding.workspace.title": "Tạo không gian làm việc của bạn",
  "onboarding.workspace.nameLabel": "Tên không gian",
  "onboarding.workspace.namePlaceholder": "Công ty Acme",
  "onboarding.workspace.urlLabel": "Đường dẫn không gian",
  "onboarding.workspace.urlPlaceholder": "acme-inc",
  "onboarding.workspace.creating": "Đang tạo…",
  "onboarding.workspace.continue": "Tiếp tục",
  "onboarding.workspace.error.create": "Không thể tạo không gian làm việc",
  "onboarding.invite.title": "Mời đội của bạn",
  "onboarding.invite.subtitle": "Giúp đội của bạn bắt đầu nhanh hơn",
  "onboarding.invite.emailPlaceholder": "dongnghiep@congty.com",
  "onboarding.invite.addAnother": "Thêm",
  "onboarding.invite.sending": "Đang gửi…",
  "onboarding.invite.send": "Gửi lời mời",
  "onboarding.invite.skip": "Bỏ qua",
  "onboarding.invite.error.send": "Không thể gửi lời mời",
  "onboarding.error.generic": "Đã xảy ra lỗi",
```

- [ ] **Step 14: Add `onboarding.*` keys to `lib/i18n/id.json`**

```json
  "onboarding.workspace.title": "Buat ruang kerja Anda",
  "onboarding.workspace.nameLabel": "Nama ruang kerja",
  "onboarding.workspace.namePlaceholder": "Acme Tbk.",
  "onboarding.workspace.urlLabel": "URL ruang kerja",
  "onboarding.workspace.urlPlaceholder": "acme-inc",
  "onboarding.workspace.creating": "Membuat…",
  "onboarding.workspace.continue": "Lanjutkan",
  "onboarding.workspace.error.create": "Gagal membuat ruang kerja",
  "onboarding.invite.title": "Undang tim Anda",
  "onboarding.invite.subtitle": "Bawa tim Anda berjalan lebih cepat",
  "onboarding.invite.emailPlaceholder": "rekan@perusahaan.com",
  "onboarding.invite.addAnother": "Tambah lagi",
  "onboarding.invite.sending": "Mengirim…",
  "onboarding.invite.send": "Kirim undangan",
  "onboarding.invite.skip": "Lewati dulu",
  "onboarding.invite.error.send": "Gagal mengirim undangan",
  "onboarding.error.generic": "Terjadi kesalahan",
```

- [ ] **Step 15: Add `onboarding.*` keys to `lib/i18n/ms.json`**

```json
  "onboarding.workspace.title": "Cipta ruang kerja anda",
  "onboarding.workspace.nameLabel": "Nama ruang kerja",
  "onboarding.workspace.namePlaceholder": "Acme Sdn. Bhd.",
  "onboarding.workspace.urlLabel": "URL ruang kerja",
  "onboarding.workspace.urlPlaceholder": "acme-inc",
  "onboarding.workspace.creating": "Mencipta…",
  "onboarding.workspace.continue": "Teruskan",
  "onboarding.workspace.error.create": "Gagal mencipta ruang kerja",
  "onboarding.invite.title": "Jemput pasukan anda",
  "onboarding.invite.subtitle": "Bawa pasukan anda bermula lebih pantas",
  "onboarding.invite.emailPlaceholder": "rakan@syarikat.com",
  "onboarding.invite.addAnother": "Tambah lagi",
  "onboarding.invite.sending": "Menghantar…",
  "onboarding.invite.send": "Hantar jemputan",
  "onboarding.invite.skip": "Langkau dahulu",
  "onboarding.invite.error.send": "Gagal menghantar jemputan",
  "onboarding.error.generic": "Sesuatu telah berlaku",
```

- [ ] **Step 16: JSON parse check + tsc**

Run:
```bash
for f in lib/i18n/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "OK $f" || echo "BROKEN $f"; done
npx tsc --noEmit
```
Expected: 16 OKs, exit code 0 from tsc.

- [ ] **Step 17: Visual smoke test**

Load `/onboarding` in `en` and `zh-CN`. Confirm both `WorkspaceStep` and `InviteStep` render translated text. Trigger the API failure path (e.g. duplicate workspace slug) to confirm error fallback message.

- [ ] **Step 18: Commit**

```bash
git add app/onboarding/page.tsx lib/i18n/*.json
git commit -m "feat: i18n onboarding workspace + invite step [LUM-42]"
```

---

## Task 4: Migrate accept-invite client

**Files:**
- Modify: `app/invite/[token]/AcceptInviteClient.tsx` (full rewrite shown)
- Modify: all 16 `lib/i18n/*.json` — append 15 keys

- [ ] **Step 1: Add 15 keys to `lib/i18n/en.json`**

```json
  "invite.accepted.title": "Invitation already accepted",
  "invite.accepted.body": "This invite link has already been used.",
  "invite.accepted.cta": "Go to workspace",
  "invite.expired.title": "Invitation expired",
  "invite.expired.body": "This invite link has expired. Ask your teammate to send a new one.",
  "invite.revoked.title": "Invitation revoked",
  "invite.revoked.body": "This invite link is no longer valid.",
  "invite.joining": "Joining {workspaceName}…",
  "invite.error.title": "Something went wrong",
  "invite.error.tryAgain": "Try again",
  "invite.error.network": "Something went wrong. Please try again.",
  "invite.signup.title": "{inviterName} invited you to join {workspaceName}",
  "invite.signup.body": "Sign up or sign in to accept the invitation.",
  "invite.signup.create": "Create account",
  "invite.signup.signin": "Sign in",
```

- [ ] **Step 2: Replace `app/invite/[token]/AcceptInviteClient.tsx`**

```tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { useIntl, FormattedMessage } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { invitesClient, ApiClientError } from '@/lib/api-client'

interface Props {
  token: string
  workspaceName: string
  workspaceSlug: string
  inviterName: string
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'
}

export function AcceptInviteClient({
  token,
  workspaceName,
  workspaceSlug,
  inviterName,
  status,
}: Props) {
  const intl = useIntl()
  const { isLoaded, isSignedIn } = useUser()
  const router = useRouter()
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isLoaded || !isSignedIn || status !== 'PENDING') return

    let cancelled = false
    const controller = new AbortController()
    setAccepting(true)

    invitesClient
      .accept(token, { signal: controller.signal })
      .then(data => {
        if (cancelled) return
        router.push(`/workspace/${data.workspaceSlug}`)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(
          err instanceof ApiClientError
            ? err.message
            : intl.formatMessage({ id: 'invite.error.network' })
        )
        setAccepting(false)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [isLoaded, isSignedIn, status, token, router, intl])

  if (status === 'ACCEPTED') {
    return (
      <>
        <h2 className='text-lg font-semibold'>
          {intl.formatMessage({ id: 'invite.accepted.title' })}
        </h2>
        <p className='text-sm text-slate-500'>
          {intl.formatMessage({ id: 'invite.accepted.body' })}
        </p>
        <Button onClick={() => router.push(`/workspace/${workspaceSlug}`)}>
          {intl.formatMessage({ id: 'invite.accepted.cta' })}
        </Button>
      </>
    )
  }

  if (status === 'EXPIRED') {
    return (
      <>
        <h2 className='text-lg font-semibold'>
          {intl.formatMessage({ id: 'invite.expired.title' })}
        </h2>
        <p className='text-sm text-slate-500'>
          {intl.formatMessage({ id: 'invite.expired.body' })}
        </p>
      </>
    )
  }

  if (status === 'REVOKED') {
    return (
      <>
        <h2 className='text-lg font-semibold'>
          {intl.formatMessage({ id: 'invite.revoked.title' })}
        </h2>
        <p className='text-sm text-slate-500'>
          {intl.formatMessage({ id: 'invite.revoked.body' })}
        </p>
      </>
    )
  }

  // PENDING — loading or auto-accepting
  if (!isLoaded || accepting) {
    return (
      <>
        <h2 className='text-lg font-semibold'>
          {intl.formatMessage(
            { id: 'invite.joining' },
            { workspaceName }
          )}
        </h2>
        <div className='flex justify-center'>
          <Spinner className='size-5 text-slate-400' />
        </div>
      </>
    )
  }

  if (error) {
    return (
      <>
        <h2 className='text-lg font-semibold text-red-600'>
          {intl.formatMessage({ id: 'invite.error.title' })}
        </h2>
        <p className='text-sm text-slate-500'>{error}</p>
        <Button variant='outline' onClick={() => setError(null)}>
          {intl.formatMessage({ id: 'invite.error.tryAgain' })}
        </Button>
      </>
    )
  }

  // Not signed in — show CTA
  const inviteUrl = `/invite/${token}`
  return (
    <>
      <h2 className='text-lg font-semibold'>
        <FormattedMessage
          id='invite.signup.title'
          values={{
            inviterName,
            workspaceName: (
              <span className='text-slate-900'>{workspaceName}</span>
            ),
          }}
        />
      </h2>
      <p className='text-sm text-slate-500'>
        {intl.formatMessage({ id: 'invite.signup.body' })}
      </p>
      <div className='flex flex-col gap-2'>
        <Button asChild className='w-full'>
          <a href={`/signup?redirect_url=${encodeURIComponent(inviteUrl)}`}>
            {intl.formatMessage({ id: 'invite.signup.create' })}
          </a>
        </Button>
        <Button asChild variant='outline' className='w-full'>
          <a href={`/signin?redirect_url=${encodeURIComponent(inviteUrl)}`}>
            {intl.formatMessage({ id: 'invite.signup.signin' })}
          </a>
        </Button>
      </div>
    </>
  )
}
```

Note: `invite.signup.title` uses `FormattedMessage` with a React element value (the styled span around the workspace name). The ICU pattern in the locale file is `"{inviterName} invited you to join {workspaceName}"` — react-intl replaces `{workspaceName}` with the supplied React node.

- [ ] **Step 3: Add `invite.*` keys to `lib/i18n/zh-CN.json`**

```json
  "invite.accepted.title": "邀请已接受",
  "invite.accepted.body": "这个邀请链接已经被使用过了。",
  "invite.accepted.cta": "前往工作区",
  "invite.expired.title": "邀请已过期",
  "invite.expired.body": "这个邀请链接已过期。请让你的队友重新发一份。",
  "invite.revoked.title": "邀请已撤销",
  "invite.revoked.body": "这个邀请链接已失效。",
  "invite.joining": "正在加入 {workspaceName}…",
  "invite.error.title": "出错了",
  "invite.error.tryAgain": "重试",
  "invite.error.network": "出错了，请重试。",
  "invite.signup.title": "{inviterName} 邀请你加入 {workspaceName}",
  "invite.signup.body": "注册或登录以接受邀请。",
  "invite.signup.create": "创建账号",
  "invite.signup.signin": "登录",
```

- [ ] **Step 4: Add `invite.*` keys to `lib/i18n/zh-TW.json`**

```json
  "invite.accepted.title": "邀請已接受",
  "invite.accepted.body": "這個邀請連結已經被使用過了。",
  "invite.accepted.cta": "前往工作區",
  "invite.expired.title": "邀請已過期",
  "invite.expired.body": "這個邀請連結已過期。請你的隊友重新傳送一份。",
  "invite.revoked.title": "邀請已撤銷",
  "invite.revoked.body": "這個邀請連結已失效。",
  "invite.joining": "正在加入 {workspaceName}…",
  "invite.error.title": "發生錯誤",
  "invite.error.tryAgain": "重試",
  "invite.error.network": "發生錯誤，請再試一次。",
  "invite.signup.title": "{inviterName} 邀請你加入 {workspaceName}",
  "invite.signup.body": "註冊或登入以接受邀請。",
  "invite.signup.create": "建立帳號",
  "invite.signup.signin": "登入",
```

- [ ] **Step 5: Add `invite.*` keys to `lib/i18n/en-GB.json` and `lib/i18n/en-AU.json`**

```json
  "invite.accepted.title": "Invitation already accepted",
  "invite.accepted.body": "This invite link has already been used.",
  "invite.accepted.cta": "Go to workspace",
  "invite.expired.title": "Invitation expired",
  "invite.expired.body": "This invite link has expired. Ask your teammate to send a new one.",
  "invite.revoked.title": "Invitation revoked",
  "invite.revoked.body": "This invite link is no longer valid.",
  "invite.joining": "Joining {workspaceName}…",
  "invite.error.title": "Something went wrong",
  "invite.error.tryAgain": "Try again",
  "invite.error.network": "Something went wrong. Please try again.",
  "invite.signup.title": "{inviterName} invited you to join {workspaceName}",
  "invite.signup.body": "Sign up or sign in to accept the invitation.",
  "invite.signup.create": "Create account",
  "invite.signup.signin": "Sign in",
```

- [ ] **Step 6: Add `invite.*` keys to `lib/i18n/es.json`**

```json
  "invite.accepted.title": "Invitación ya aceptada",
  "invite.accepted.body": "Este enlace de invitación ya se ha utilizado.",
  "invite.accepted.cta": "Ir al espacio",
  "invite.expired.title": "Invitación caducada",
  "invite.expired.body": "Este enlace de invitación ha caducado. Pide a tu compañero que envíe uno nuevo.",
  "invite.revoked.title": "Invitación revocada",
  "invite.revoked.body": "Este enlace de invitación ya no es válido.",
  "invite.joining": "Uniéndote a {workspaceName}…",
  "invite.error.title": "Algo salió mal",
  "invite.error.tryAgain": "Reintentar",
  "invite.error.network": "Algo salió mal. Inténtalo de nuevo.",
  "invite.signup.title": "{inviterName} te ha invitado a unirte a {workspaceName}",
  "invite.signup.body": "Regístrate o inicia sesión para aceptar la invitación.",
  "invite.signup.create": "Crear cuenta",
  "invite.signup.signin": "Iniciar sesión",
```

- [ ] **Step 7: Add `invite.*` keys to `lib/i18n/es-419.json`**

Same as `es.json`, except:
```json
  "invite.error.tryAgain": "Volver a intentar",
  "invite.signup.title": "{inviterName} te invitó a unirte a {workspaceName}",
```

- [ ] **Step 8: Add `invite.*` keys to `lib/i18n/fr.json`**

```json
  "invite.accepted.title": "Invitation déjà acceptée",
  "invite.accepted.body": "Ce lien d'invitation a déjà été utilisé.",
  "invite.accepted.cta": "Aller à l'espace",
  "invite.expired.title": "Invitation expirée",
  "invite.expired.body": "Ce lien d'invitation a expiré. Demandez à votre coéquipier d'en envoyer un nouveau.",
  "invite.revoked.title": "Invitation révoquée",
  "invite.revoked.body": "Ce lien d'invitation n'est plus valide.",
  "invite.joining": "Connexion à {workspaceName}…",
  "invite.error.title": "Une erreur s'est produite",
  "invite.error.tryAgain": "Réessayer",
  "invite.error.network": "Une erreur s'est produite. Veuillez réessayer.",
  "invite.signup.title": "{inviterName} vous a invité à rejoindre {workspaceName}",
  "invite.signup.body": "Inscrivez-vous ou connectez-vous pour accepter l'invitation.",
  "invite.signup.create": "Créer un compte",
  "invite.signup.signin": "Se connecter",
```

- [ ] **Step 9: Add `invite.*` keys to `lib/i18n/de.json`**

```json
  "invite.accepted.title": "Einladung bereits angenommen",
  "invite.accepted.body": "Dieser Einladungslink wurde bereits verwendet.",
  "invite.accepted.cta": "Zum Workspace",
  "invite.expired.title": "Einladung abgelaufen",
  "invite.expired.body": "Dieser Einladungslink ist abgelaufen. Bitten Sie Ihren Teamkollegen um einen neuen.",
  "invite.revoked.title": "Einladung widerrufen",
  "invite.revoked.body": "Dieser Einladungslink ist nicht mehr gültig.",
  "invite.joining": "Beitritt zu {workspaceName}…",
  "invite.error.title": "Etwas ist schiefgelaufen",
  "invite.error.tryAgain": "Erneut versuchen",
  "invite.error.network": "Etwas ist schiefgelaufen. Bitte erneut versuchen.",
  "invite.signup.title": "{inviterName} hat Sie zu {workspaceName} eingeladen",
  "invite.signup.body": "Registrieren oder anmelden, um die Einladung anzunehmen.",
  "invite.signup.create": "Konto erstellen",
  "invite.signup.signin": "Anmelden",
```

- [ ] **Step 10: Add `invite.*` keys to `lib/i18n/ja.json`**

```json
  "invite.accepted.title": "招待は既に承諾されています",
  "invite.accepted.body": "この招待リンクは既に使用されました。",
  "invite.accepted.cta": "ワークスペースへ",
  "invite.expired.title": "招待は期限切れです",
  "invite.expired.body": "この招待リンクは期限切れです。チームメンバーに新しいリンクを送ってもらってください。",
  "invite.revoked.title": "招待は取り消されました",
  "invite.revoked.body": "この招待リンクは無効です。",
  "invite.joining": "{workspaceName} に参加中…",
  "invite.error.title": "エラーが発生しました",
  "invite.error.tryAgain": "再試行",
  "invite.error.network": "エラーが発生しました。もう一度お試しください。",
  "invite.signup.title": "{inviterName} さんがあなたを {workspaceName} に招待しました",
  "invite.signup.body": "招待を承諾するにはサインアップまたはサインインしてください。",
  "invite.signup.create": "アカウント作成",
  "invite.signup.signin": "サインイン",
```

- [ ] **Step 11: Add `invite.*` keys to `lib/i18n/ko.json`**

```json
  "invite.accepted.title": "이미 수락된 초대입니다",
  "invite.accepted.body": "이 초대 링크는 이미 사용되었습니다.",
  "invite.accepted.cta": "워크스페이스로 이동",
  "invite.expired.title": "초대가 만료되었습니다",
  "invite.expired.body": "이 초대 링크는 만료되었습니다. 동료에게 새 링크를 요청하세요.",
  "invite.revoked.title": "초대가 취소되었습니다",
  "invite.revoked.body": "이 초대 링크는 더 이상 유효하지 않습니다.",
  "invite.joining": "{workspaceName}에 참여 중…",
  "invite.error.title": "문제가 발생했습니다",
  "invite.error.tryAgain": "다시 시도",
  "invite.error.network": "문제가 발생했습니다. 다시 시도해 주세요.",
  "invite.signup.title": "{inviterName}님이 {workspaceName}에 초대했습니다",
  "invite.signup.body": "초대를 수락하려면 가입하거나 로그인하세요.",
  "invite.signup.create": "계정 만들기",
  "invite.signup.signin": "로그인",
```

- [ ] **Step 12: Add `invite.*` keys to `lib/i18n/hi.json`**

```json
  "invite.accepted.title": "आमंत्रण पहले से स्वीकार किया गया",
  "invite.accepted.body": "इस आमंत्रण लिंक का पहले ही उपयोग किया जा चुका है।",
  "invite.accepted.cta": "वर्कस्पेस पर जाएं",
  "invite.expired.title": "आमंत्रण समाप्त",
  "invite.expired.body": "इस आमंत्रण लिंक की अवधि समाप्त हो गई है। अपने साथी से नया भेजने को कहें।",
  "invite.revoked.title": "आमंत्रण रद्द",
  "invite.revoked.body": "यह आमंत्रण लिंक अब मान्य नहीं है।",
  "invite.joining": "{workspaceName} में शामिल हो रहे हैं…",
  "invite.error.title": "कुछ गलत हो गया",
  "invite.error.tryAgain": "पुनः प्रयास करें",
  "invite.error.network": "कुछ गलत हो गया। कृपया पुनः प्रयास करें।",
  "invite.signup.title": "{inviterName} ने आपको {workspaceName} में शामिल होने के लिए आमंत्रित किया",
  "invite.signup.body": "आमंत्रण स्वीकार करने के लिए साइन अप या साइन इन करें।",
  "invite.signup.create": "खाता बनाएं",
  "invite.signup.signin": "साइन इन",
```

- [ ] **Step 13: Add `invite.*` keys to `lib/i18n/ru.json`**

```json
  "invite.accepted.title": "Приглашение уже принято",
  "invite.accepted.body": "Эта ссылка-приглашение уже использована.",
  "invite.accepted.cta": "В рабочее пространство",
  "invite.expired.title": "Приглашение истекло",
  "invite.expired.body": "Срок действия ссылки-приглашения истёк. Попросите коллегу прислать новую.",
  "invite.revoked.title": "Приглашение отозвано",
  "invite.revoked.body": "Эта ссылка-приглашение больше не действительна.",
  "invite.joining": "Присоединение к {workspaceName}…",
  "invite.error.title": "Что-то пошло не так",
  "invite.error.tryAgain": "Повторить",
  "invite.error.network": "Что-то пошло не так. Попробуйте снова.",
  "invite.signup.title": "{inviterName} пригласил(а) вас в {workspaceName}",
  "invite.signup.body": "Зарегистрируйтесь или войдите, чтобы принять приглашение.",
  "invite.signup.create": "Создать аккаунт",
  "invite.signup.signin": "Войти",
```

- [ ] **Step 14: Add `invite.*` keys to `lib/i18n/vi.json`**

```json
  "invite.accepted.title": "Lời mời đã được chấp nhận",
  "invite.accepted.body": "Liên kết lời mời này đã được sử dụng.",
  "invite.accepted.cta": "Đến không gian làm việc",
  "invite.expired.title": "Lời mời đã hết hạn",
  "invite.expired.body": "Liên kết lời mời này đã hết hạn. Hãy yêu cầu đồng đội gửi một lời mời mới.",
  "invite.revoked.title": "Lời mời đã bị thu hồi",
  "invite.revoked.body": "Liên kết lời mời này không còn hợp lệ.",
  "invite.joining": "Đang tham gia {workspaceName}…",
  "invite.error.title": "Đã xảy ra lỗi",
  "invite.error.tryAgain": "Thử lại",
  "invite.error.network": "Đã xảy ra lỗi. Vui lòng thử lại.",
  "invite.signup.title": "{inviterName} đã mời bạn tham gia {workspaceName}",
  "invite.signup.body": "Đăng ký hoặc đăng nhập để chấp nhận lời mời.",
  "invite.signup.create": "Tạo tài khoản",
  "invite.signup.signin": "Đăng nhập",
```

- [ ] **Step 15: Add `invite.*` keys to `lib/i18n/id.json`**

```json
  "invite.accepted.title": "Undangan sudah diterima",
  "invite.accepted.body": "Tautan undangan ini sudah pernah digunakan.",
  "invite.accepted.cta": "Ke ruang kerja",
  "invite.expired.title": "Undangan kedaluwarsa",
  "invite.expired.body": "Tautan undangan ini sudah kedaluwarsa. Minta rekan Anda mengirim yang baru.",
  "invite.revoked.title": "Undangan dicabut",
  "invite.revoked.body": "Tautan undangan ini tidak berlaku lagi.",
  "invite.joining": "Bergabung ke {workspaceName}…",
  "invite.error.title": "Terjadi kesalahan",
  "invite.error.tryAgain": "Coba lagi",
  "invite.error.network": "Terjadi kesalahan. Silakan coba lagi.",
  "invite.signup.title": "{inviterName} mengundang Anda bergabung ke {workspaceName}",
  "invite.signup.body": "Daftar atau masuk untuk menerima undangan.",
  "invite.signup.create": "Buat akun",
  "invite.signup.signin": "Masuk",
```

- [ ] **Step 16: Add `invite.*` keys to `lib/i18n/ms.json`**

```json
  "invite.accepted.title": "Jemputan sudah diterima",
  "invite.accepted.body": "Pautan jemputan ini sudah digunakan.",
  "invite.accepted.cta": "Ke ruang kerja",
  "invite.expired.title": "Jemputan tamat tempoh",
  "invite.expired.body": "Pautan jemputan ini telah tamat tempoh. Minta rakan anda menghantar yang baharu.",
  "invite.revoked.title": "Jemputan dibatalkan",
  "invite.revoked.body": "Pautan jemputan ini tidak lagi sah.",
  "invite.joining": "Menyertai {workspaceName}…",
  "invite.error.title": "Sesuatu telah berlaku",
  "invite.error.tryAgain": "Cuba lagi",
  "invite.error.network": "Sesuatu telah berlaku. Sila cuba lagi.",
  "invite.signup.title": "{inviterName} menjemput anda menyertai {workspaceName}",
  "invite.signup.body": "Daftar atau log masuk untuk menerima jemputan.",
  "invite.signup.create": "Cipta akaun",
  "invite.signup.signin": "Log masuk",
```

- [ ] **Step 17: JSON parse + tsc**

```bash
for f in lib/i18n/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "OK $f" || echo "BROKEN $f"; done
npx tsc --noEmit
```
Expected: 16 OKs and tsc clean.

- [ ] **Step 18: Visual smoke test**

If a test invite URL is available, load it in `en` and `zh-CN`. Test each branch by manipulating status param: ACCEPTED, EXPIRED, REVOKED, PENDING (unauthenticated), PENDING (signed-in). Confirm the `{inviterName}` and `{workspaceName}` placeholders interpolate correctly.

If preview is unavailable, run unit test verification: `npm test -- --testPathPattern=invite`.

- [ ] **Step 19: Commit**

```bash
git add app/invite/[token]/AcceptInviteClient.tsx lib/i18n/*.json
git commit -m "feat: i18n accept-invite client [LUM-42]"
```

---

## Task 5: Migrate LogoUploader component

**Files:**
- Modify: `components/LogoUploader.tsx` (full rewrite shown)
- Modify: all 16 `lib/i18n/*.json` — append 8 keys

- [ ] **Step 1: Add 8 keys to `lib/i18n/en.json`**

```json
  "logoUploader.sizeError": "File must be 2 MB or smaller",
  "logoUploader.processError": "Failed to process image",
  "logoUploader.cropTooLarge": "Cropped image is too large. Try a smaller crop.",
  "logoUploader.uploadFailed": "Upload failed",
  "logoUploader.uploadRetry": "Upload failed, please try again",
  "logoUploader.success": "Logo updated",
  "logoUploader.dialogTitle": "Crop logo",
  "logoUploader.saving": "Saving…",
```

Note: `Cancel` and `Save` buttons reuse the existing `common.cancel` / `common.save` keys, so no new keys are needed for those.

- [ ] **Step 2: Replace `components/LogoUploader.tsx`**

```tsx
'use client'

import { useRef, useState, useCallback } from 'react'
import ReactCrop, {
  type Crop,
  centerCrop,
  makeAspectCrop,
} from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { Camera } from 'lucide-react'
import { toast } from 'sonner'
import { useIntl } from 'react-intl'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const MAX_BYTES = 2 * 1024 * 1024 // 2 MB

interface LogoUploaderProps {
  currentLogoUrl: string | null | undefined
  workspaceName: string
  /** Called with the new public URL after a successful upload. */
  onUpload: (logoUrl: string) => void
  /** Upload function — receives FormData, returns Response. Use workspacesClient.uploadLogo. */
  upload: (formData: FormData) => Promise<Response>
}

function initCrop(width: number, height: number): Crop {
  return centerCrop(
    makeAspectCrop({ unit: '%', width: 80 }, 1, width, height),
    width,
    height
  )
}

export function LogoUploader({
  currentLogoUrl,
  workspaceName,
  onUpload,
  upload,
}: LogoUploaderProps) {
  const intl = useIntl()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const [sizeError, setSizeError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [srcUrl, setSrcUrl] = useState<string | null>(null)
  const [crop, setCrop] = useState<Crop>()
  const [uploading, setUploading] = useState(false)

  const initials = workspaceName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('')

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!fileInputRef.current || !file) return
    fileInputRef.current.value = ''
    if (file.size > MAX_BYTES) {
      setSizeError(intl.formatMessage({ id: 'logoUploader.sizeError' }))
      return
    }
    setSizeError(null)
    const objectUrl = URL.createObjectURL(file)
    setSrcUrl(objectUrl)
    setDialogOpen(true)
  }

  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth, naturalHeight } = e.currentTarget
      setCrop(initCrop(naturalWidth, naturalHeight))
    },
    []
  )

  async function handleSave() {
    const img = imgRef.current
    if (!img || !crop || !srcUrl) return

    const canvas = document.createElement('canvas')
    const pixelCrop = {
      x: (crop.x / 100) * img.naturalWidth,
      y: (crop.y / 100) * img.naturalHeight,
      width: (crop.width / 100) * img.naturalWidth,
      height: (crop.height / 100) * img.naturalHeight,
    }
    const size = Math.min(pixelCrop.width, pixelCrop.height, 512)
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(
      img,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      size,
      size
    )

    canvas.toBlob(
      async blob => {
        if (!blob) {
          toast.error(intl.formatMessage({ id: 'logoUploader.processError' }))
          return
        }
        if (blob.size > MAX_BYTES) {
          toast.error(intl.formatMessage({ id: 'logoUploader.cropTooLarge' }))
          return
        }

        setUploading(true)
        try {
          const formData = new FormData()
          formData.append('file', blob, 'logo.jpg')
          const res = await upload(formData)
          const data = await res.json()
          if (!res.ok)
            throw new Error(
              data.error ??
                intl.formatMessage({ id: 'logoUploader.uploadFailed' })
            )
          onUpload(data.logoUrl as string)
          setDialogOpen(false)
          URL.revokeObjectURL(srcUrl)
          setSrcUrl(null)
          toast.success(intl.formatMessage({ id: 'logoUploader.success' }))
        } catch (err) {
          toast.error(
            err instanceof Error
              ? err.message
              : intl.formatMessage({ id: 'logoUploader.uploadRetry' })
          )
        } finally {
          setUploading(false)
        }
      },
      'image/jpeg',
      0.9
    )
  }

  function handleCancel() {
    setDialogOpen(false)
    if (srcUrl) URL.revokeObjectURL(srcUrl)
    setSrcUrl(null)
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type='file'
        accept='image/png,image/jpeg,image/webp'
        className='hidden'
        onChange={handleFileChange}
      />

      <div className='flex flex-col items-end gap-1'>
        <button
          type='button'
          onClick={() => fileInputRef.current?.click()}
          className='relative group size-10 rounded-lg overflow-hidden shrink-0'
        >
          {currentLogoUrl ? (
            <img
              src={currentLogoUrl}
              alt={workspaceName}
              className='size-full object-contain'
            />
          ) : (
            <div className='size-full bg-zinc-800 dark:bg-zinc-700 flex items-center justify-center text-sm font-bold text-white'>
              {initials || '?'}
            </div>
          )}
          <div className='absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center'>
            <Camera size={16} className='text-white' />
          </div>
        </button>
        {sizeError && <p className='text-xs text-red-500'>{sizeError}</p>}
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={open => {
          if (!open) handleCancel()
        }}
      >
        <DialogContent className='max-w-sm'>
          <DialogHeader>
            <DialogTitle>
              {intl.formatMessage({ id: 'logoUploader.dialogTitle' })}
            </DialogTitle>
          </DialogHeader>
          {srcUrl && (
            <div className='flex justify-center'>
              <ReactCrop
                {...(crop !== undefined ? { crop } : {})}
                onChange={(_, percentCrop) => setCrop(percentCrop)}
                aspect={1}
                circularCrop={false}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={imgRef}
                  src={srcUrl}
                  alt=''
                  onLoad={handleImageLoad}
                  className='max-h-[360px] max-w-full object-contain'
                />
              </ReactCrop>
            </div>
          )}
          <DialogFooter>
            <Button variant='ghost' onClick={handleCancel} disabled={uploading}>
              {intl.formatMessage({ id: 'common.cancel' })}
            </Button>
            <Button onClick={handleSave} disabled={uploading}>
              {uploading
                ? intl.formatMessage({ id: 'logoUploader.saving' })
                : intl.formatMessage({ id: 'common.save' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
```

Note: The crop-preview `<img>` `alt` is changed from `'crop preview'` to empty `''` — the image is purely decorative inside an interactive crop UI; an empty alt is the correct a11y choice and removes the need for an i18n key.

- [ ] **Step 3: Add `logoUploader.*` keys to `lib/i18n/zh-CN.json`**

```json
  "logoUploader.sizeError": "文件必须不超过 2 MB",
  "logoUploader.processError": "处理图片失败",
  "logoUploader.cropTooLarge": "裁剪后的图片过大，请缩小裁剪范围。",
  "logoUploader.uploadFailed": "上传失败",
  "logoUploader.uploadRetry": "上传失败，请重试",
  "logoUploader.success": "Logo 已更新",
  "logoUploader.dialogTitle": "裁剪 Logo",
  "logoUploader.saving": "保存中…",
```

- [ ] **Step 4: Add `logoUploader.*` keys to `lib/i18n/zh-TW.json`**

```json
  "logoUploader.sizeError": "檔案必須不超過 2 MB",
  "logoUploader.processError": "處理圖片失敗",
  "logoUploader.cropTooLarge": "裁剪後的圖片過大，請縮小裁剪範圍。",
  "logoUploader.uploadFailed": "上傳失敗",
  "logoUploader.uploadRetry": "上傳失敗，請重試",
  "logoUploader.success": "Logo 已更新",
  "logoUploader.dialogTitle": "裁剪 Logo",
  "logoUploader.saving": "儲存中…",
```

- [ ] **Step 5: Add `logoUploader.*` keys to `lib/i18n/en-GB.json` and `lib/i18n/en-AU.json`**

```json
  "logoUploader.sizeError": "File must be 2 MB or smaller",
  "logoUploader.processError": "Failed to process image",
  "logoUploader.cropTooLarge": "Cropped image is too large. Try a smaller crop.",
  "logoUploader.uploadFailed": "Upload failed",
  "logoUploader.uploadRetry": "Upload failed, please try again",
  "logoUploader.success": "Logo updated",
  "logoUploader.dialogTitle": "Crop logo",
  "logoUploader.saving": "Saving…",
```

- [ ] **Step 6: Add `logoUploader.*` keys to `lib/i18n/es.json` and `lib/i18n/es-419.json`**

```json
  "logoUploader.sizeError": "El archivo debe ser de 2 MB o menos",
  "logoUploader.processError": "No se pudo procesar la imagen",
  "logoUploader.cropTooLarge": "La imagen recortada es demasiado grande. Prueba un recorte más pequeño.",
  "logoUploader.uploadFailed": "Error al subir",
  "logoUploader.uploadRetry": "Error al subir, inténtalo de nuevo",
  "logoUploader.success": "Logo actualizado",
  "logoUploader.dialogTitle": "Recortar logo",
  "logoUploader.saving": "Guardando…",
```

- [ ] **Step 7: Add `logoUploader.*` keys to `lib/i18n/fr.json`**

```json
  "logoUploader.sizeError": "Le fichier doit faire 2 Mo ou moins",
  "logoUploader.processError": "Échec du traitement de l'image",
  "logoUploader.cropTooLarge": "L'image rognée est trop grande. Essayez un recadrage plus petit.",
  "logoUploader.uploadFailed": "Échec du téléversement",
  "logoUploader.uploadRetry": "Échec du téléversement, veuillez réessayer",
  "logoUploader.success": "Logo mis à jour",
  "logoUploader.dialogTitle": "Rogner le logo",
  "logoUploader.saving": "Enregistrement…",
```

- [ ] **Step 8: Add `logoUploader.*` keys to `lib/i18n/de.json`**

```json
  "logoUploader.sizeError": "Die Datei darf höchstens 2 MB groß sein",
  "logoUploader.processError": "Bild konnte nicht verarbeitet werden",
  "logoUploader.cropTooLarge": "Das zugeschnittene Bild ist zu groß. Versuchen Sie einen kleineren Ausschnitt.",
  "logoUploader.uploadFailed": "Upload fehlgeschlagen",
  "logoUploader.uploadRetry": "Upload fehlgeschlagen, bitte erneut versuchen",
  "logoUploader.success": "Logo aktualisiert",
  "logoUploader.dialogTitle": "Logo zuschneiden",
  "logoUploader.saving": "Wird gespeichert…",
```

- [ ] **Step 9: Add `logoUploader.*` keys to `lib/i18n/ja.json`**

```json
  "logoUploader.sizeError": "ファイルは 2 MB 以下である必要があります",
  "logoUploader.processError": "画像の処理に失敗しました",
  "logoUploader.cropTooLarge": "切り抜いた画像が大きすぎます。範囲を小さくしてください。",
  "logoUploader.uploadFailed": "アップロードに失敗しました",
  "logoUploader.uploadRetry": "アップロードに失敗しました。もう一度お試しください。",
  "logoUploader.success": "ロゴを更新しました",
  "logoUploader.dialogTitle": "ロゴを切り抜く",
  "logoUploader.saving": "保存中…",
```

- [ ] **Step 10: Add `logoUploader.*` keys to `lib/i18n/ko.json`**

```json
  "logoUploader.sizeError": "파일은 2 MB 이하여야 합니다",
  "logoUploader.processError": "이미지 처리에 실패했습니다",
  "logoUploader.cropTooLarge": "잘라낸 이미지가 너무 큽니다. 더 작게 잘라보세요.",
  "logoUploader.uploadFailed": "업로드에 실패했습니다",
  "logoUploader.uploadRetry": "업로드에 실패했습니다. 다시 시도해 주세요.",
  "logoUploader.success": "로고가 업데이트되었습니다",
  "logoUploader.dialogTitle": "로고 자르기",
  "logoUploader.saving": "저장 중…",
```

- [ ] **Step 11: Add `logoUploader.*` keys to `lib/i18n/hi.json`**

```json
  "logoUploader.sizeError": "फ़ाइल 2 MB या उससे कम होनी चाहिए",
  "logoUploader.processError": "छवि प्रसंस्करण विफल",
  "logoUploader.cropTooLarge": "क्रॉप की गई छवि बहुत बड़ी है। छोटा क्रॉप आज़माएं।",
  "logoUploader.uploadFailed": "अपलोड विफल",
  "logoUploader.uploadRetry": "अपलोड विफल, कृपया पुनः प्रयास करें",
  "logoUploader.success": "लोगो अपडेट किया गया",
  "logoUploader.dialogTitle": "लोगो क्रॉप करें",
  "logoUploader.saving": "सहेजा जा रहा है…",
```

- [ ] **Step 12: Add `logoUploader.*` keys to `lib/i18n/ru.json`**

```json
  "logoUploader.sizeError": "Размер файла не должен превышать 2 МБ",
  "logoUploader.processError": "Не удалось обработать изображение",
  "logoUploader.cropTooLarge": "Обрезанное изображение слишком большое. Попробуйте уменьшить область.",
  "logoUploader.uploadFailed": "Не удалось загрузить",
  "logoUploader.uploadRetry": "Не удалось загрузить. Попробуйте ещё раз.",
  "logoUploader.success": "Логотип обновлён",
  "logoUploader.dialogTitle": "Обрезать логотип",
  "logoUploader.saving": "Сохранение…",
```

- [ ] **Step 13: Add `logoUploader.*` keys to `lib/i18n/vi.json`**

```json
  "logoUploader.sizeError": "Tệp phải nhỏ hơn hoặc bằng 2 MB",
  "logoUploader.processError": "Xử lý hình ảnh thất bại",
  "logoUploader.cropTooLarge": "Hình ảnh đã cắt quá lớn. Hãy thử cắt nhỏ hơn.",
  "logoUploader.uploadFailed": "Tải lên thất bại",
  "logoUploader.uploadRetry": "Tải lên thất bại, vui lòng thử lại",
  "logoUploader.success": "Đã cập nhật logo",
  "logoUploader.dialogTitle": "Cắt logo",
  "logoUploader.saving": "Đang lưu…",
```

- [ ] **Step 14: Add `logoUploader.*` keys to `lib/i18n/id.json`**

```json
  "logoUploader.sizeError": "Ukuran berkas harus 2 MB atau lebih kecil",
  "logoUploader.processError": "Gagal memproses gambar",
  "logoUploader.cropTooLarge": "Gambar yang dipotong terlalu besar. Coba potongan yang lebih kecil.",
  "logoUploader.uploadFailed": "Gagal mengunggah",
  "logoUploader.uploadRetry": "Gagal mengunggah, silakan coba lagi",
  "logoUploader.success": "Logo diperbarui",
  "logoUploader.dialogTitle": "Potong logo",
  "logoUploader.saving": "Menyimpan…",
```

- [ ] **Step 15: Add `logoUploader.*` keys to `lib/i18n/ms.json`**

```json
  "logoUploader.sizeError": "Saiz fail mestilah 2 MB atau lebih kecil",
  "logoUploader.processError": "Gagal memproses imej",
  "logoUploader.cropTooLarge": "Imej yang dipotong terlalu besar. Cuba potongan lebih kecil.",
  "logoUploader.uploadFailed": "Muat naik gagal",
  "logoUploader.uploadRetry": "Muat naik gagal, sila cuba lagi",
  "logoUploader.success": "Logo dikemas kini",
  "logoUploader.dialogTitle": "Potong logo",
  "logoUploader.saving": "Menyimpan…",
```

- [ ] **Step 16: JSON parse + tsc**

```bash
for f in lib/i18n/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "OK $f" || echo "BROKEN $f"; done
npx tsc --noEmit
```
Expected: 16 OKs and tsc clean.

- [ ] **Step 17: Visual smoke test**

Load any page that renders `LogoUploader` (workspace settings page typically) in `en` and `zh-CN`. Confirm:
- Hover-overlay camera icon appears.
- Picking an oversized file shows the localized size error.
- Crop dialog title renders translated.
- Save button shows "Save" / "保存" → "Saving…" / "保存中…" during upload.

- [ ] **Step 18: Commit**

```bash
git add components/LogoUploader.tsx lib/i18n/*.json
git commit -m "feat: i18n LogoUploader component [LUM-42]"
```

---

## Task 6: Locale parity test (optional but recommended)

**Files:**
- Create: `__tests__/i18n-locale-parity.test.ts`

This task adds a single unit test that asserts every non-English locale has the same key set as `en.json`. Skip if scope/time is tight; the JSON-parse check in earlier tasks already guards against broken files.

- [ ] **Step 1: Create the test**

```ts
// __tests__/i18n-locale-parity.test.ts
import en from '../lib/i18n/en.json'
import zhCN from '../lib/i18n/zh-CN.json'
import zhTW from '../lib/i18n/zh-TW.json'
import enGB from '../lib/i18n/en-GB.json'
import enAU from '../lib/i18n/en-AU.json'
import es from '../lib/i18n/es.json'
import es419 from '../lib/i18n/es-419.json'
import fr from '../lib/i18n/fr.json'
import de from '../lib/i18n/de.json'
import ja from '../lib/i18n/ja.json'
import ko from '../lib/i18n/ko.json'
import hi from '../lib/i18n/hi.json'
import ru from '../lib/i18n/ru.json'
import vi from '../lib/i18n/vi.json'
import id from '../lib/i18n/id.json'
import ms from '../lib/i18n/ms.json'

const LOCALES: Record<string, Record<string, string>> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en-GB': enGB,
  'en-AU': enAU,
  es,
  'es-419': es419,
  fr,
  de,
  ja,
  ko,
  hi,
  ru,
  vi,
  id,
  ms,
}

describe('i18n locale parity', () => {
  const enKeys = Object.keys(en).sort()

  for (const [locale, messages] of Object.entries(LOCALES)) {
    test(`${locale} has the same key set as en.json`, () => {
      const localeKeys = Object.keys(messages).sort()
      const missing = enKeys.filter(k => !(k in messages))
      const extra = localeKeys.filter(k => !(k in en))
      expect({ missing, extra }).toEqual({ missing: [], extra: [] })
    })
  }

  for (const [locale, messages] of Object.entries(LOCALES)) {
    test(`${locale} provides non-empty values`, () => {
      const empties = Object.entries(messages)
        .filter(([, v]) => !v || v.trim() === '')
        .map(([k]) => k)
      expect(empties).toEqual([])
    })
  }
})
```

- [ ] **Step 2: Run the test**

Run: `npm test -- --testPathPattern=i18n-locale-parity`
Expected: 30 passing tests (15 locales × 2 assertions).
If any fail with `missing` keys, go back and add them to the named locale file.

- [ ] **Step 3: Commit**

```bash
git add __tests__/i18n-locale-parity.test.ts
git commit -m "test: add i18n locale parity guard [LUM-42]"
```

---

## Task 7: Final verification

- [ ] **Step 1: Final type check**

Run: `npx tsc --noEmit`
Expected: exit code 0.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all tests pass. (No prior tests reference the migrated pages by string, so this should be clean.)

- [ ] **Step 3: Lint** (if a lint script exists)

Run: `npm run lint`
Expected: clean. If new no-string-literal rules trip, address them.

- [ ] **Step 4: End-to-end smoke**

Start dev server with `preview_start` and visit:
- `/signup` in `en` and `zh-CN` — confirm strings.
- `/onboarding` in `en` and `zh-CN` — workspace + invite step.
- An invite URL (any 4 status states) in `en` and `zh-CN`.

Take a screenshot of `/onboarding` in `zh-CN` and one in `en` for the PR description.

- [ ] **Step 5: Push branch and open PR**

```bash
git push -u origin lumo/LUM-42-i18n-onboarding-flow
gh pr create --title "feat: i18n new-user flow + logo uploader [LUM-42]" --body "$(cat <<'EOF'
## Summary
- Wire up `react-intl` in `app/signup/[[...signup]]/page.tsx`, `app/onboarding/page.tsx`, `app/invite/[token]/AcceptInviteClient.tsx`, and `components/LogoUploader.tsx`.
- Add ~61 new keys (`waitlist.*`, `onboarding.*`, `invite.*`, `logoUploader.*`) across all 16 locale files with proper native translations (no English fallback).
- Add `i18n-locale-parity.test.ts` to guard against future drift.

## Test plan
- [x] `npx tsc --noEmit` clean
- [x] `npm test` clean
- [x] All 16 locale JSON files parse
- [x] Visual smoke: `/signup`, `/onboarding`, `/invite/[token]` in `en` and `zh-CN`
- [ ] Native-speaker review of non-en/zh translations (post-merge follow-up if needed)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the executor

- **JSON syntax when appending keys:** every locale block in this plan shows keys with a trailing comma. When pasting into a locale file, place the new block AFTER an existing key (and ensure that existing key ends with `,`) and BEFORE the file's closing `}`. If the new block ends up as the LAST entry in the file, delete the trailing comma on the final new key. Validate with the `for f in lib/i18n/*.json; node -e "JSON.parse(...)"` loop in each task's verification step.
- **Don't translate the ICU placeholder `{workspaceName}` / `{inviterName}`** — keep them verbatim in every locale. Re-order them inside the sentence as the target language requires.
- **Em-dash `–` (U+2013) and `…` (U+2026)** are intentional — preserve them; don't normalise to `-` or `...`.
- **`onboarding.workspace.urlPlaceholder` stays `acme-inc` in every locale** — it's a slug example, not translatable text.
- **`waitlist.placeholder.email` stays `you@company.com` in `en`, but localise the sample in other languages** to a recognisable local pattern (e.g. `tu@empresa.com`).
- **Locale file ordering:** the existing files don't sort alphabetically — they group by namespace. Append new blocks at the bottom or near other `waitlist.*` / `onboarding.*` / `invite.*` keys if any exist. Don't reorder existing keys.
- **No CLAUDE.md violation:** every locale gets a real translation. The codebase rule is hard — Tier-5 review will flag English fallbacks.
- **Server-thrown error messages (`data.error || ...`)** keep the API-returned text as priority and fall back to the i18n string. Server-side i18n is out of scope for this PR.
