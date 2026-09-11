# ClothingCatalogBot — Bot specification

**Archetype:** commerce

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

A lightweight Telegram catalogue bot that lets shoppers browse a small clothing catalogue (Мужская, Женская, Детская) with photos, titles, descriptions and prices (RUB). Users can paginate category lists, view product detail cards, and send an inquiry about a product; inquiries are persisted and forwarded to the owner's admin chat with a deep link to message the user.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Consumers browsing clothing catalogues on Telegram
- Small retail owners who want a read-only product catalogue with lead capture

## Success criteria

- Users can open /start and reach category lists via buttons
- Users can page through category product lists (8 items/page) with Prev/Next
- Users can open a product detail card and submit an inquiry (with optional message)
- Each inquiry is persisted and a notification containing product snapshot, user name+id, message and a deep link to the user is delivered to ADMIN_CHAT_ID within 10s
- Bot handles empty categories and missing photos gracefully (fallback image or placeholder message)

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main menu and welcome message with category buttons and Browse All
  - outputs: welcome_text, inline_keyboard: [Мужская, Женская, Детская, Browse All]
- **Мужская** (button, actor: user, callback: category:male) — Open the Мужская category product list (page 1)
  - outputs: list_of_product_previews (up to 8), inline_keyboard for each item: [View details, Back], pagination_buttons if >8
- **View details** (button, actor: user, callback: product:view:<product_id>) — Open product card with full photo, description and action buttons
  - inputs: product_id
  - outputs: product_card (photo, title, description, price), inline_keyboard: [Ask about this, Back to category, Main menu]
- **Ask about this** (button, actor: user, callback: inquiry:start:<product_id>) — Open a ForceReply modal asking for an optional message to send to admin about this product
  - inputs: optional message text
  - outputs: confirmation to user, persisted inquiry, admin notification message

## Flows

### Onboard and show main menu
_Trigger:_ /start

1. Send welcome text in bot voice explaining catalog and how to ask about items
2. Show inline keyboard: Мужская, Женская, Детская, Browse All
3. Log session start (no PII persisted beyond minimal user record)

_Data touched:_ User

### Browse category (paginated)
_Trigger:_ callback category:<id> or Browse All

1. Load products for category (or all) sorted by owner-provided order
2. Return up to 8 product preview messages (photo thumbnail or primary photo + title + price)
3. Attach inline buttons per product: View details and Back
4. Attach Prev/Next pagination callbacks when total_items > page_size
5. Maintain pagination state in callback payload

_Data touched:_ Product, Category

### View product details
_Trigger:_ callback product:view:<product_id>

1. Render product card: single large photo, title, full short description, price (e.g. 1999 ₽)
2. Show inline buttons: Ask about this, Back to category, Main menu
3. If photo missing, show placeholder image and note 'Фото недоступно'

_Data touched:_ Product

### Create inquiry (lead) and notify admin
_Trigger:_ callback inquiry:start:<product_id> -> ForceReply or typed input

1. Prompt user for optional message using ForceReply (user may send empty reply or cancel)
2. On reply, create Inquiry record with product_id, user_id, user_display (name), message, timestamp
3. Persist inquiry to storage
4. Send admin notification to ADMIN_CHAT_ID containing: product snapshot (title, price, photo or thumbnail), inquiry message (or '—' if empty), user display name + Telegram id, deep link to start chat with user (tg://user?id=<user_id>) and a link/deep link to view product in-bot if platform supports
5. Send user confirmation message: inquiry received and admin will contact them

_Data touched:_ Inquiry, User, Product

### Pagination navigation
_Trigger:_ callback category:page:<category_id>:<page_number>

1. Validate requested page against current product count
2. Render requested page of up to 8 previews
3. If page invalid (out-of-range) show friendly error and reset to nearest valid page

_Data touched:_ Product, Category

## Owner-supplied settings

The OWNER provides these; they are collected in chat and injected into the environment at deploy. Read each one from the environment where it is used (`ctx.env.<KEY>` / `env.<KEY>` on Cloudflare Workers; `process.env.<KEY>` only as a Node/harness fallback — never the sole read). Do NOT invent your own way of learning the value, do NOT ask for it in a bot message, and do NOT hardcode a default.

- **ADMIN_CHAT_ID** — Telegram chat id where product inquiries and lead notifications will be sent
  - this is the OWNER's own chat id; the platform already knows it. Read `ADMIN_CHAT_ID` via `ctx.env` (prefer toolkit `adminChatId` / `requireOwner`) — never ask a user, never treat whoever writes first as the admin, never invent claim-admin or open manage for everyone.
  - may be UNSET at runtime: the bot must still start, and the feature needing ADMIN_CHAT_ID must say so plainly instead of failing.

Your behavioral specs run WITHOUT these values, so no spec may depend on one.

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

An entity that merely NAMES an owner-supplied setting above (an admin chat, an API account) is not something to store or discover — read it from the environment.

- **Category** _(retention: persistent)_ — Pre-seeded product categories
  - fields: id, title
- **Product** _(retention: persistent)_ — Catalogue products shown to users
  - fields: id, category_id, photo_file_id_or_url, title, short_description, price_minor_units, currency
- **Inquiry** _(retention: persistent)_ — User requests for more product information (lead)
  - fields: id, product_id, user_id, user_display_name, message_text, timestamp, sent_to_admin_at
- **User** _(retention: persistent)_ — Minimal user record captured to allow admin follow-up and dedupe
  - fields: user_id, first_name, last_name, username, last_interaction_at

## Integrations

- **Telegram** (required) — Bot API messaging, inline keyboards, ForceReply, photo sending, deep links
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Provide ADMIN_CHAT_ID (where inquiries are delivered) via platform config
- Seed the product catalogue (title, description, price, photo) prior to public use
- Update or remove products via the platform owner's product management UI (not in-chat)
- View persisted inquiries in the owner's inbox/chat (Telegram) and in-platform inquiry list if available

## Notifications

- Admin notification on new inquiry: includes product snapshot (title, price, photo/thumbnail), inquiry message (or placeholder), user display name and Telegram id, deep link to chat with the user
- User confirmation after inquiry is created: brief acknowledgement in bot voice

## Permissions & privacy

- Bot stores minimal user data (user_id, display name) only to include in inquiry notifications and for admin follow-up
- Product catalogue and inquiries are persisted until owner deletes them
- Owner is responsible for compliance with local data protection laws when collecting user messages and storing leads
- No payments or sensitive financial data are collected by the bot

## Edge cases

- Category contains zero products — show friendly message 'В этой категории пока нет товаров' and a Back/Main menu button
- Product missing photo — display a placeholder image and note 'Фото недоступно'
- User cancels ForceReply or sends no message — create inquiry with empty message body and clearly indicate to admin that message was optional
- ADMIN_CHAT_ID not set or invalid — capture inquiry but queue it; notify owner during platform setup time and show user a graceful message 'Ваша заявка сохранена, но администратор недоступен. Мы свяжемся с вами.'
- Pagination requested for page > available — return nearest valid page and inform user
- Network errors sending admin notification — retry with backoff and mark inquiry.sent_to_admin_at when successful; surface failure in logs and optionally to owner

## Required tests

- Dialog-level acceptance: /start → main menu buttons displayed
- Browse flow: open category with >8 products → Prev/Next visible and navigation works
- Product card: View details shows photo, full description and price formatting with ₽ symbol
- Inquiry flow: Ask about this → ForceReply → send text → Inquiry persisted and admin receives correctly formatted notification including product snapshot and user deep link
- Inquiry edge: Ask without message → admin receives inquiry with empty message placeholder
- Missing photo: product with no photo uses placeholder and still allows inquiry
- ADMIN_CHAT_ID missing: inquiry persists and user sees fallback confirmation; system queues admin notification

## Assumptions

- Owner will provide the product dataset (images, titles, descriptions, prices) before launch via the platform UI
- Categories are exactly the three supplied: 'Мужская', 'Женская', 'Детская' and seeded at install
- Currency is RUB and prices are shown with ₽ symbol (owner can confirm if different)
- Single admin chat receives all inquiries (no multi-admin routing required)
- Photos are single primary images per product (no multi-image gallery)
