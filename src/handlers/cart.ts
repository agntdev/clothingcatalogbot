import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { addCartItem, cartFor, changeCartItem, clearCart, formatPrice, markInquirySent, productById, removeCartItem, saveInquiry, saveUser, type CartItem, type Inquiry } from "../catalog.js";
import { now } from "../clock.js";
import { answerCallback, replaceCallbackMessage } from "../callbacks.js";
import { adminChatId, inlineButton, inlineKeyboard, urlButton } from "../toolkit/index.js";

const composer = new Composer<Ctx>();

function display(ctx: Ctx) { const u = ctx.from; return [u?.first_name, u?.last_name].filter(Boolean).join(" ") || u?.username || "Покупатель"; }
function itemTotal(item: CartItem) { return item.price_snapshot_rub * item.qty; }
function money(minor: number) { return formatPrice({ id: "", category_id: "", title: "", short_description: "", price_minor_units: minor, currency: "RUB" }); }
function cartTotal(items: CartItem[]) { return items.reduce((sum, item) => sum + itemTotal(item), 0); }
function cartText(items: CartItem[]) {
  if (!items.length) return "Корзина пуста. Добавьте товар из каталога.";
  return ["Ваша корзина", "", ...items.map((item, index) => `${index + 1}. ${item.title_snapshot}\n${money(item.price_snapshot_rub)} × ${item.qty} = ${money(itemTotal(item))}`), "", `Итого: ${money(cartTotal(items))}`].join("\n");
}
function cartKeyboard(items: CartItem[]) {
  const rows = items.flatMap((item) => [
    [inlineButton("−", `cart:qty:${item.id}:-1`), inlineButton(`${item.qty} шт.`, "cart:open"), inlineButton("+", `cart:qty:${item.id}:1`)],
    [inlineButton("Удалить", `cart:remove:${item.id}`)],
  ]);
  if (items.length) rows.push([inlineButton("Очистить корзину", "cart:clear")], [inlineButton("Отправить запрос", "cart:checkout")]);
  rows.push([inlineButton("Главное меню", "menu:main")]);
  return inlineKeyboard(rows);
}
async function showCart(ctx: Ctx) {
  if (!ctx.from) return;
  const cart = await cartFor(ctx, ctx.from.id);
  const items = cart?.items ?? [];
  // Telegram cannot embed thumbnails in a text message. Send small item cards
  // first; a missing/expired file id simply leaves the complete text cart below.
  for (const item of items) {
    if (!item.thumbnail_url) continue;
    try { await ctx.replyWithPhoto(item.thumbnail_url, { caption: `${item.title_snapshot}\n${money(item.price_snapshot_rub)} × ${item.qty}` }); } catch { /* a stale thumbnail must not block checkout */ }
  }
  if (ctx.callbackQuery) await replaceCallbackMessage(ctx, cartText(items), cartKeyboard(items));
  else await ctx.reply(cartText(items), { reply_markup: cartKeyboard(items) });
}
async function notify(ctx: Ctx, inquiry: Inquiry): Promise<boolean> {
  const admin = adminChatId(ctx as Ctx & { env?: Record<string, unknown> });
  if (!admin || !/^-?\d+$/.test(admin)) return false;
  const items = inquiry.cart_snapshot ?? [];
  const text = ["Новый запрос из корзины", ...items.map((item) => `• ${item.title_snapshot}: ${item.qty} × ${money(item.price_snapshot_rub)} = ${money(itemTotal(item))}`), `Итого: ${money(inquiry.total_minor_units ?? 0)}`, `Покупатель: ${inquiry.user_display_name} (Telegram ID: ${inquiry.user_id})`].join("\n");
  try {
    await ctx.api.sendMessage(admin, text, { reply_markup: inlineKeyboard([[urlButton("Ответить покупателю", `tg://user?id=${inquiry.user_id}`)]]) });
    await markInquirySent(ctx, inquiry.id, now());
    return true;
  } catch { return false; }
}

composer.command("cart", async (ctx) => { await showCart(ctx); });
composer.callbackQuery("cart:open", async (ctx) => { await answerCallback(ctx); await showCart(ctx); });
composer.callbackQuery(/^cart:add:([^:]+)$/, async (ctx) => {
  await answerCallback(ctx);
  if (!ctx.from) return;
  const product = await productById(ctx, ctx.match[1]);
  if (!product || product.visible === false) { await replaceCallbackMessage(ctx, "Этот товар больше недоступен. Выберите другой товар в каталоге.", inlineKeyboard([[inlineButton("Главное меню", "menu:main")]])); return; }
  const cart = await addCartItem(ctx, product, ctx.from.id, now());
  if (!cart) { await ctx.reply("Не удалось добавить товар в корзину. Попробуйте ещё раз."); return; }
  await ctx.reply(`«${product.title}» добавлен в корзину.`, { reply_markup: inlineKeyboard([[inlineButton("Корзина", "cart:open")]]) });
});
composer.callbackQuery(/^cart:qty:([^:]+):(-?\d+)$/, async (ctx) => {
  await answerCallback(ctx); if (!ctx.from) return;
  const delta = Number(ctx.match[2]); if (!Number.isInteger(delta) || Math.abs(delta) !== 1) return;
  const cart = await changeCartItem(ctx, ctx.from.id, ctx.match[1], delta, now());
  if (!cart) { await ctx.reply("Не удалось изменить количество. Откройте корзину ещё раз."); return; }
  await replaceCallbackMessage(ctx, cartText(cart.items), cartKeyboard(cart.items));
});
composer.callbackQuery(/^cart:remove:([^:]+)$/, async (ctx) => { await answerCallback(ctx); if (!ctx.from) return; await removeCartItem(ctx, ctx.from.id, ctx.match[1], now()); await showCart(ctx); });
composer.callbackQuery("cart:clear", async (ctx) => { await answerCallback(ctx); if (!ctx.from) return; await clearCart(ctx, ctx.from.id, now()); await showCart(ctx); });
composer.callbackQuery("cart:checkout", async (ctx) => {
  await answerCallback(ctx); if (!ctx.from) return;
  const cart = await cartFor(ctx, ctx.from.id); const items = cart?.items ?? [];
  if (!items.length) { await showCart(ctx); return; }
  const timestamp = now();
  const inquiry: Inquiry = { id: `cart-${ctx.from.id}-${timestamp}-${crypto.randomUUID()}`, product_id: "cart", user_id: ctx.from.id, user_display_name: display(ctx), message_text: "", timestamp, kind: "cart", cart_snapshot: items, total_minor_units: cartTotal(items), status: "new", username: ctx.from.username };
  await saveUser(ctx, timestamp);
  const saved = await saveInquiry(ctx, inquiry);
  const sent = saved && await notify(ctx, inquiry);
  if (sent) await clearCart(ctx, ctx.from.id, now());
  await replaceCallbackMessage(ctx, sent ? "Запрос отправлен. Продавец свяжется с вами." : "Ваша заявка сохранена, но администратор недоступен. Мы свяжемся с вами.", inlineKeyboard([[inlineButton("Главное меню", "menu:main")]]));
});

export default composer;
