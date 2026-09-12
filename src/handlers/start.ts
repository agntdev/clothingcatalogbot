import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard, isOwner } from "../toolkit/index.js";
import { now } from "../clock.js";
import { categoriesFor, categoryReviewReport, markCategoryReviewReported, migrateCatalog, saveUser, type Product } from "../catalog.js";
import { answerCallback, replaceCallbackMessage } from "../callbacks.js";
import { resetNavigation } from "../navigation.js";

const composer = new Composer<Ctx>();
export const MENU_TEXT = "Выберите категорию. Откройте товар и нажмите «Задать вопрос», чтобы связаться с продавцом.";

export async function mainMenu(ctx: Ctx) {
  const roots = await categoriesFor(ctx, null);
  const rows = roots.map((category) => [inlineButton(category.title.slice(0, 60), `category:open:${category.id}`)]);
  rows.push([inlineButton("Все товары", "category:list:all:1")]);
  rows.push([inlineButton("Корзина", "cart:open")]);
  if (isOwner(ctx)) rows.push([inlineButton("⚙️ Админ-панель", "admin:open")]);
  return inlineKeyboard(rows);
}

async function sendMigrationReport(ctx: Ctx, products: Product[]): Promise<void> {
  const admin = adminChatId(ctx as Ctx & { env?: Record<string, unknown> });
  if (!admin || !/^-?\d+$/.test(admin)) return;
  const pending = products.length ? products : await categoryReviewReport(ctx);
  if (!pending.length) return;
  try {
    for (let offset = 0; offset < pending.length; offset += 40) {
      const chunk = pending.slice(offset, offset + 40);
      const heading = offset === 0 ? "Проверьте категории товаров после переноса:" : "Продолжение списка товаров для проверки:";
      await ctx.api.sendMessage(admin, `${heading}\n${chunk.map((product) => `• ${product.title}`).join("\n")}`.slice(0, 3500), {
        reply_markup: inlineKeyboard(chunk.map((product) => [inlineButton(`Проверить: ${product.title}`.slice(0, 60), `admin:product:open:${product.id}`)])),
      });
    }
    await markCategoryReviewReported(ctx);
  } catch {
    // The durable pending marker keeps the report available for a later /start.
  }
}

function clearPendingInquiry(ctx: Ctx) {
  ctx.session.inquiryProductId = undefined;
  ctx.session.inquiryStartedAt = undefined;
  ctx.session.inquirySubmitting = undefined;
  ctx.session.adminDraft = undefined;
  ctx.session.adminStep = undefined;
  ctx.session.adminCategoryParentId = undefined;
  ctx.session.adminCategoryTargetId = undefined;
}

composer.command("start", async (ctx) => {
  clearPendingInquiry(ctx);
  resetNavigation(ctx);
  const migrated = await migrateCatalog(ctx);
  await saveUser(ctx, now());
  await ctx.reply(MENU_TEXT, { reply_markup: await mainMenu(ctx) });
  await sendMigrationReport(ctx, migrated);
});

composer.callbackQuery("menu:main", async (ctx) => {
  await answerCallback(ctx);
  clearPendingInquiry(ctx);
  resetNavigation(ctx);
  await replaceCallbackMessage(ctx, MENU_TEXT, await mainMenu(ctx));
});

export default composer;
