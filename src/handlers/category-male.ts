import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { categoryTitle, formatPrice, productsFor, type CategoryId } from "../catalog.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { answerCallback, replaceCallbackMessage } from "../callbacks.js";

const composer = new Composer<Ctx>();
const PAGE_SIZE = 8;

registerMainMenuItem({ label: "Мужская", data: "category:male", order: 10 });
registerMainMenuItem({ label: "Женская", data: "category:female", order: 20 });
registerMainMenuItem({ label: "Детская", data: "category:kids", order: 30 });
registerMainMenuItem({ label: "Все товары", data: "category:all", order: 40 });

function controls(category: CategoryId, page: number, total: number) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = [];
  if (pages > 1) {
    const nav = [];
    if (page > 1) nav.push(inlineButton("Назад", `category:page:${category}:${page - 1}`));
    if (page < pages) nav.push(inlineButton("Далее", `category:page:${category}:${page + 1}`));
    if (nav.length) rows.push(nav);
  }
  rows.push([inlineButton("В главное меню", "menu:main")]);
  return inlineKeyboard(rows);
}

async function preview(ctx: Ctx, id: CategoryId, wantedPage: number) {
  const products = await productsFor(ctx, id);
  const pages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, wantedPage), pages);
  const resetNote = page !== wantedPage ? " Страница обновлена." : "";
  if (products.length === 0) {
    await replaceCallbackMessage(ctx,
      wantedPage === page ? "В этой категории пока нет товаров" : "В этой категории пока нет товаров. Открыта первая страница.",
      controls(id, 1, 0),
    );
    return;
  }
  await replaceCallbackMessage(ctx, `${categoryTitle(id)} — страница ${page} из ${pages}.${resetNote}`, controls(id, page, products.length));
  for (const product of products.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)) {
    const text = `${product.title}\n${formatPrice(product)}`;
    const markup = inlineKeyboard([
      [inlineButton("Открыть товар", `product:view:${product.id}`)],
      [inlineButton("К категории", `category:${id}`)],
    ]);
    if (product.photo_file_id_or_url) {
      await ctx.replyWithPhoto(product.photo_file_id_or_url, { caption: text, reply_markup: markup });
    } else {
      await ctx.reply(`${text}\nФото недоступно`, { reply_markup: markup });
    }
  }
}

composer.callbackQuery("category:male", async (ctx) => {
  await answerCallback(ctx);
  await preview(ctx, "male", 1);
});

composer.callbackQuery(/^category:(female|kids|all)$/, async (ctx) => {
  await answerCallback(ctx);
  await preview(ctx, ctx.match[1] as CategoryId, 1);
});

composer.callbackQuery(/^category:page:(male|female|kids|all):(\d+)$/, async (ctx) => {
  await answerCallback(ctx);
  await preview(ctx, ctx.match[1] as CategoryId, Number(ctx.match[2]));
});

export default composer;
