import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const search   = searchParams.get('search')   ?? '';
    const category = searchParams.get('category') ?? '';
    const minPrice = parseFloat(searchParams.get('minPrice') ?? '0') || 0;
    const maxPrice = parseFloat(searchParams.get('maxPrice') ?? '999999999') || 999999999;
    const page     = Math.max(1, parseInt(searchParams.get('page')     ?? '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '20', 10)));
    const offset   = (page - 1) * pageSize;

    const supabase = getSupabaseAdmin();

    // FIX R02: Use a single query with proper JOIN for category + inventory.
    // Category filter uses categories!inner so non-matching rows are excluded.
    // Inventory is fetched in the same query to avoid N+1 round-trips.
    let query = supabase
      .from('products')
      .select(category ? '*, categories!inner(name, slug), inventory(stock)' : '*, categories(name, slug), inventory(stock)')
      .eq('active', true)
      .gte('price', minPrice)
      .lte('price', maxPrice)
      .order('created_at', { ascending: false });

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    // FIX R02: reassign `query` (not shadow with `const`) so the filter is applied.
    if (category) {
      query = query.eq('categories.slug', category);
    }

    const { data: resultRows, error: queryErr } = await query;
    if (queryErr) throw queryErr;

    // FIX: No more N+1 per-product inventory fetch or artificial delay.
    const productsWithStock: Array<Record<string, unknown> & { stock: number }> = (resultRows || []).map(product => {
      const { categories, inventory, ...rest } = product;
      return {
        ...rest,
        category_name: Array.isArray(categories) ? categories[0]?.name : (categories as any)?.name,
        category_slug: Array.isArray(categories) ? categories[0]?.slug : (categories as any)?.slug,
        stock: Array.isArray(inventory) ? (inventory[0]?.stock ?? 0) : ((inventory as any)?.stock ?? 0),
      };
    });

    const paginated = productsWithStock.slice(offset, offset + pageSize);
    const total = productsWithStock.length;

    return NextResponse.json({
      data: paginated,
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      error: null,
    });
  } catch (err) {
    console.error('[products GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
