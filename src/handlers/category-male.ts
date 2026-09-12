import { Composer } from "grammy";
import type { CatalogView, Ctx } from "../bot.js";
import { categoriesFor, categoryById, categoryTitle, formatPrice, productsFor } from "../catalog.js";
import { inlineButton, inlineKeyboard, isOwner } from "../toolkit/index.js";
import { answerCallback, replaceCallbackMessage } from "../callbacks.js";
import { currentView, popView, pushView } from "../navigation.js";

const composer = new Composer<Ctx>();
const PAGE_SIZE = 8;

function backRow() { return [inlineButton("Назад", "catalog:back")]; }

export async function renderSection(ctx: Ctx, categoryId: string): Promise<void> {
  const [category, children] = await Promise.all([categoryById(ctx, categoryId), categoriesFor(ctx, categoryId)]);
  const title = category?.title ?? categoryTitle(categoryId);
  const rows = children.map((child) => [inlineButton(child.title, `category:open:${child.id}`)]);
  rows.push([inlineButton("Все товары раздела", `category:list:${categoryId}:1`)]);
  rows.push(backRow());
  await replaceCallbackMessage(ctx, `Раздел «${title}». Выберите подраздел или откройте все товары.`, inlineKeyboard(rows));
}

export async function renderList(ctx: Ctx, categoryId: string, wantedPage: number): Promise<void> {
  const products = await productsFor(ctx, categoryId);
  const pages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, wantedPage), pages);
  const title = (await categoryById(ctx, categoryId))?.title ?? categoryTitle(categoryId);
  ctx.session.catalogCategory = categoryId;
  ctx.session.catalogPage = page;
  if (!products.length) {
    await replaceCallbackMessage(ctx, wantedPage === page ? "В этой категории пока нет товаров" : "В этой категории пока нет товаров. Открыта первая страница.", inlineKeyboard([backRow()]));
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
  await replaceCallbackMessage(ctx, `${title} — страница ${page} из ${pages}.${page !== wantedPage ? " Открыта ближайшая доступная страница." : ""}`, inlineKeyboard(rows));
}

export async function renderView(ctx: Ctx, view: CatalogView): Promise<void> {
  if (view.kind === "menu") {
    const rows = [
      [inlineButton("Мужская", "category:open:male")], [inlineButton("Женская", "category:open:female")], [inlineButton("Детская", "category:open:kids")], [inlineButton("Все товары", "category:list:all:1")],
    ];
    if (isOwner(ctx)) rows.push([inlineButton("Управление каталогом", "admin:open")]);
    await replaceCallbackMessage(ctx, "Выберите раздел. Откройте товар и нажмите «Задать вопрос», чтобы связаться с продавцом.", inlineKeyboard(rows));
  } else if (view.kind === "section" && view.categoryId) await renderSection(ctx, view.categoryId);
  else if (view.kind === "list" && view.categoryId) await renderList(ctx, view.categoryId, view.page ?? 1);
}

composer.callbackQuery(/^category:(male|female|kids)$/, async (ctx) => { await answerCallback(ctx); pushView(ctx, { kind: "section", categoryId: ctx.match[1] }); await renderSection(ctx, ctx.match[1]); });
composer.callbackQuery(/^category:open:([^:]+)$/, async (ctx) => { await answerCallback(ctx); pushView(ctx, { kind: "section", categoryId: ctx.match[1] }); await renderSection(ctx, ctx.match[1]); });
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
