import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getSupabaseAdmin } from '@/lib/supabase';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

async function ensureCart(userId: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data: existing } = await supabase.from('carts').select('id').eq('user_id', userId).maybeSingle();
  if (existing) return existing.id;
  const { data: created } = await supabase.from('carts').insert({ user_id: userId }).select('id').single();
  return created!.id;
}

async function syncCartToDB(
  userId: string,
  items: Array<{ product_id: string; quantity: number; unit_price: number }>
): Promise<void> {
  const cartId = await ensureCart(userId);
  const supabase = getSupabaseAdmin();
  await supabase.from('cart_items').delete().eq('cart_id', cartId);
  for (const item of items) {
    if (item.quantity > 0) {
      await supabase.from('cart_items').upsert({
        cart_id: cartId,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price
      }, { onConflict: 'cart_id, product_id' });
    }
  }
}

/** POST /api/cart/items — add or increment an item */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json() as { product_id?: string; quantity?: number };
    const { product_id, quantity = 1 } = body;
    if (!product_id || quantity < 1) {
      return NextResponse.json({ error: 'product_id and positive quantity required' }, { status: 400 });
    }

    // Validate product and stock
    const supabase = getSupabaseAdmin();
    const { data: prodData } = await supabase
      .from('products')
      .select('id, name, price, active, inventory(stock)')
      .eq('id', product_id)
      .single();

    if (!prodData) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    if (!prodData.active) return NextResponse.json({ error: 'Product is not available' }, { status: 400 });

    const inv = Array.isArray(prodData.inventory) ? prodData.inventory[0] : prodData.inventory;
    const stock = (inv as any)?.stock ?? 0; // Not used below, but keeping logic

    // Load existing cart from DB (source of truth — not Redis)
    const cartId = await ensureCart(session.userId);
    const { data: dbItems } = await supabase
      .from('cart_items')
      .select('product_id, unit_price, quantity, products!inner(name, price)')
      .eq('cart_id', cartId);

    const items: Array<{ product_id: string; name: string; price: number; unit_price: number; quantity: number }> =
      dbItems?.map(row => {
        const prod = Array.isArray(row.products) ? row.products[0] : row.products;
        return {
          product_id: row.product_id,
          name: (prod as any)?.name,
          price: Number((prod as any)?.price),
          unit_price: Number(row.unit_price),
          quantity: row.quantity,
        };
      }) ?? [];

    const existing = items.find((i) => i.product_id === product_id);
    if (existing) {
      existing.quantity += quantity;
    } else {
      items.push({
        product_id,
        name: prodData.name,
        price: Number(prodData.price),
        unit_price: Number(prodData.price),
        quantity,
      });
    }

    await syncCartToDB(session.userId, items);

    return NextResponse.json({ data: items, error: null }, { status: 201 });
  } catch (err) {
    console.error('[cart items POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
