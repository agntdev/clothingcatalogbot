import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { categoryTitle, formatPrice, productsFor, type CategoryId } from "../catalog.js";
import { inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { answerCallback, replaceCallbackMessage } from "../callbacks.js";

const composer = new Composer<Ctx>();
const PAGE_SIZE = 8;

function controls(category: CategoryId, page: number, total: number) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rows = [];
  if (pages > 1) {
    const nav = [];
    if (page > 1) nav.push(inlineButton("Предыдущая", `category:page:${category}:${page - 1}`));
    if (page < pages) nav.push(inlineButton("Далее", `category:page:${category}:${page + 1}`));
    if (nav.length) rows.push(nav);
  }
  rows.push([inlineButton("Назад", "menu:main")]);
  return inlineKeyboard(rows);
}

async function preview(ctx: Ctx, id: CategoryId, wantedPage: number) {
  const products = await productsFor(ctx, id);
  const pages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, wantedPage), pages);
  const resetNote = page !== wantedPage ? " Открыта ближайшая доступная страница." : "";
  ctx.session.catalogCategory = id;
  ctx.session.catalogPage = page;
  if (products.length === 0) {
    await replaceCallbackMessage(ctx,
      wantedPage === page ? "В этой категории пока нет товаров" : "В этой категории пока нет товаров. Открыта первая страница.",
      controls(id, 1, 0),
    );
    return;
  }
  const pageProducts = products.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const rows = pageProducts.map((product) => [
    inlineButton(`${product.title} — ${formatPrice(product)}`, `product:view:${product.id}:${id}:${page}`),
  ]);
  const navigation = controls(id, page, products.length).inline_keyboard;
  await replaceCallbackMessage(
    ctx,
    `${categoryTitle(id)} — страница ${page} из ${pages}.${resetNote}`,
    inlineKeyboard([...rows, ...navigation]),
  );
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
