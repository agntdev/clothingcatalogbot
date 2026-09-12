import { Composer } from "grammy";
import type { CatalogView, Ctx } from "../bot.js";
import { categoryById, categoryTitle, formatPrice, productsFor } from "../catalog.js";
import { inlineButton, inlineKeyboard, isOwner } from "../toolkit/index.js";
import { answerCallback, replaceCallbackMessage } from "../callbacks.js";
import { currentView, popView, pushView } from "../navigation.js";

const composer = new Composer<Ctx>();
const PAGE_SIZE = 8;

function backRow() { return [inlineButton("Назад", "catalog:back")]; }
function mainMenuRow() { return [inlineButton("Главное меню", "menu:main")]; }

export async function renderList(ctx: Ctx, categoryId: string, wantedPage: number): Promise<void> {
  const products = await productsFor(ctx, categoryId);
  const pages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, wantedPage), pages);
  const title = (await categoryById(ctx, categoryId))?.title ?? categoryTitle(categoryId);
  ctx.session.catalogCategory = categoryId;
  ctx.session.catalogPage = page;
  if (!products.length) {
    await replaceCallbackMessage(ctx, wantedPage === page ? "В этой категории пока нет товаров" : "В этой категории пока нет товаров. Открыта первая страница.", inlineKeyboard([backRow(), mainMenuRow()]));
    return;
  }
  const rows = products.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((product) => [
    inlineButton(`${product.title} — ${formatPrice(product)}`, `product:view:${product.id}`),
  ]);
  const nav = [];
  if (page > 1) nav.push(inlineButton("Предыдущая", `category:page:${categoryId}:${page - 1}`));
  if (page < pages) nav.push(inlineButton("Далее", `category:page:${categoryId}:${page + 1}`));
  if (nav.length) rows.push(nav);
  rows.push(backRow());
  rows.push(mainMenuRow());
  await replaceCallbackMessage(ctx, `${title} — страница ${page} из ${pages}.${page !== wantedPage ? " Открыта ближайшая доступная страница." : ""}`, inlineKeyboard(rows));
}

export async function renderView(ctx: Ctx, view: CatalogView): Promise<void> {
  if (view.kind === "menu") {
    const rows = [
      [inlineButton("Одежда", "category:clothes")], [inlineButton("Обувь", "category:shoes")], [inlineButton("Аксессуары", "category:accessories")], [inlineButton("Все товары", "category:list:all:1")],
    ];
    if (isOwner(ctx)) rows.push([inlineButton("Управление каталогом", "admin:open")]);
    await replaceCallbackMessage(ctx, "Выберите категорию. Откройте товар и нажмите «Задать вопрос», чтобы связаться с продавцом.", inlineKeyboard(rows));
  } else if (view.kind === "list" && view.categoryId) await renderList(ctx, view.categoryId, view.page ?? 1);
}

composer.callbackQuery(/^category:(clothes|shoes|accessories)$/, async (ctx) => { await answerCallback(ctx); pushView(ctx, { kind: "list", categoryId: ctx.match[1], page: 1 }); await renderList(ctx, ctx.match[1], 1); });
composer.callbackQuery(/^category:(?:list|page):([^:]+):(\d+)$/, async (ctx) => {
  await answerCallback(ctx);
  const categoryId = ctx.match[1]; const page = Number(ctx.match[2]);
  const view = { kind: "list" as const, categoryId, page };
  if (currentView(ctx).kind === "list" && currentView(ctx).categoryId === categoryId) {
    ctx.session.catalogStack![ctx.session.catalogStack!.length - 1] = view;
    ctx.session.catalogCategory = categoryId; ctx.session.catalogPage = page;
  } else pushView(ctx, view);
  await renderList(ctx, categoryId, page);
});
composer.callbackQuery("category:all", async (ctx) => { await answerCallback(ctx); pushView(ctx, { kind: "list", categoryId: "all", page: 1 }); await renderList(ctx, "all", 1); });
composer.callbackQuery("catalog:back", async (ctx) => { await answerCallback(ctx); await renderView(ctx, popView(ctx)); });

export default composer;
