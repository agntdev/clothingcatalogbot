import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { commentsFor, productById, saveComment, saveUser, type Comment } from "../catalog.js";
import { now } from "../clock.js";
import { answerCallback, replaceCallbackMessage } from "../callbacks.js";
import { adminChatId, inlineButton, inlineKeyboard, urlButton } from "../toolkit/index.js";

const composer = new Composer<Ctx>();
const TTL = 5 * 60 * 1000;
function display(ctx: Ctx) { const u = ctx.from; return [u?.first_name, u?.last_name].filter(Boolean).join(" ") || u?.username || "Покупатель"; }
async function notify(ctx: Ctx, comment: Comment) { const admin = adminChatId(ctx as Ctx & { env?: Record<string, unknown> }); if (!admin || !/^-?\d+$/.test(admin)) return; try { await ctx.api.sendMessage(admin, `Новый отзыв\n${comment.user_display_name}: ${comment.text}`, { reply_markup: inlineKeyboard([[urlButton("Ответить покупателю", `tg://user?id=${comment.user_id}`)]]) }); } catch { /* notification failures must not lose a review */ } }
async function show(ctx: Ctx, productId: string, requested = 1) {
  const product = await productById(ctx, productId); if (!product) return;
  const page = await commentsFor(ctx, productId, requested);
  const lines = page.items.length ? page.items.map((x) => `• ${x.user_display_name}: ${x.text}`).join("\n") : "Отзывов пока нет.";
  const rows = [[inlineButton("Оставить отзыв", `comment:start:${productId}`)]];
  if (page.page < page.pages) rows.push([inlineButton("Показать ещё", `comment:page:${productId}:${page.page + 1}`)]);
  rows.push([inlineButton("К товару", `product:view:${productId}`)], [inlineButton("Главное меню", "menu:main")]);
  await replaceCallbackMessage(ctx, `${product.title}\n\nОтзывы\n${lines}`, inlineKeyboard(rows));
}
composer.callbackQuery(/^comment:show:([^:]+)$/, async (ctx) => { await answerCallback(ctx); await show(ctx, ctx.match[1]); });
composer.callbackQuery(/^comment:page:([^:]+):(\d+)$/, async (ctx) => { await answerCallback(ctx); await show(ctx, ctx.match[1], Number(ctx.match[2])); });
composer.callbackQuery(/^comment:start:([^:]+)$/, async (ctx) => { await answerCallback(ctx); const p = await productById(ctx, ctx.match[1]); if (!p) { await replaceCallbackMessage(ctx, "Этот товар больше недоступен. Выберите другой товар в каталоге."); return; } ctx.session.commentProductId = p.id; ctx.session.commentStartedAt = now(); await ctx.reply("Напишите отзыв о товаре. Не более 1000 символов.", { reply_markup: { force_reply: true, input_field_placeholder: "Ваш отзыв" } }); });
composer.on("message:text", async (ctx, next) => {
  const productId = ctx.session.commentProductId; if (!productId) return next(); ctx.session.commentProductId = undefined;
  if ((ctx.session.commentStartedAt ?? 0) + TTL < now()) { await ctx.reply("Время для отзыва истекло. Откройте товар и попробуйте ещё раз."); return; }
  const text = ctx.message.text.trim(); if (!text || text.length > 1000) { await ctx.reply("Отзыв должен содержать от 1 до 1000 символов. Откройте товар и попробуйте ещё раз."); return; }
  if (!ctx.from || !await productById(ctx, productId)) { await ctx.reply("Этот товар больше недоступен. Выберите другой товар в каталоге."); return; }
  const comment: Comment = { id: crypto.randomUUID(), product_id: productId, user_id: ctx.from.id, user_display_name: display(ctx), text, created_at: now() };
  const saved = await saveComment(ctx, comment); await saveUser(ctx, now()); if (!saved) { await ctx.reply("Не удалось сохранить отзыв. Попробуйте ещё раз."); return; }
  await notify(ctx, comment); await ctx.reply("Отзыв опубликован.", { reply_markup: inlineKeyboard([[inlineButton("Посмотреть отзывы", `comment:show:${productId}`)]]) });
});
export default composer;
