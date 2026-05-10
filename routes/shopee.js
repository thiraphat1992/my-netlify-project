const express = require('express')
const router = express.Router()
const https = require('https')
const crypto = require('crypto')
const { requireAuth } = require('../middleware/auth')
const { supabaseAdmin } = require('../config/supabase')

const SHOPEE_HOST = 'partner.shopeemobile.com'

// ─── Signature ────────────────────────────────────────────────────────────────
function shopeeSign(partnerId, partnerKey, apiPath, ts, accessToken, shopId) {
  const base = `${partnerId}${apiPath}${ts}${accessToken}${shopId}`
  return crypto.createHmac('sha256', partnerKey).update(base).digest('hex')
}

// ─── HTTP call ────────────────────────────────────────────────────────────────
function shopeeCall(store, method, apiPath, params = null) {
  return new Promise((resolve, reject) => {
    const ts   = Math.floor(Date.now() / 1000)
    const pid  = String(store.channel_id)
    const pkey = store.channel_secret
    const sid  = String(store.shop_id)
    const tok  = store.access_token
    const sign = shopeeSign(pid, pkey, apiPath, ts, tok, sid)

    // encode access_token — it may contain +/= characters
    const baseQs = `partner_id=${pid}&timestamp=${ts}&sign=${sign}&shop_id=${sid}&access_token=${encodeURIComponent(tok)}`

    const isGet = method.toUpperCase() === 'GET'
    let reqPath, bodyStr = ''

    if (isGet) {
      const extraQs = params
        ? Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
        : ''
      reqPath = `${apiPath}?${baseQs}${extraQs ? '&' + extraQs : ''}`
    } else {
      reqPath = `${apiPath}?${baseQs}`
      bodyStr = params ? JSON.stringify(params) : ''
    }

    console.log(`[Shopee] ${method.toUpperCase()} https://${SHOPEE_HOST}${reqPath.split('?')[0]} | pid=${pid} sid=${sid} tok_len=${tok?.length}`)

    const headers = isGet
      ? {}
      : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) }

    const options = { hostname: SHOPEE_HOST, port: 443, path: reqPath, method: method.toUpperCase(), headers }

    const req = https.request(options, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        console.log(`[Shopee] response status=${res.statusCode} body_start=${data.slice(0, 120)}`)
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(new Error(`Shopee parse error: ${data.slice(0, 300)}`)) }
      })
    })
    req.on('error', reject)
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

// ─── Doc number ───────────────────────────────────────────────────────────────
async function generateOrderNo() {
  const ym = `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}`
  const { data: seq } = await supabaseAdmin.from('doc_sequences').select('*').eq('doc_type', 'shopee_order').single()
  let n = 1
  if (seq) {
    n = (seq.year_month === ym ? seq.last_number : 0) + 1
    await supabaseAdmin.from('doc_sequences').update({ last_number: n, year_month: ym, updated_at: new Date() }).eq('doc_type', 'shopee_order')
  } else {
    await supabaseAdmin.from('doc_sequences').insert({ doc_type: 'shopee_order', prefix: 'SP', last_number: 1, year_month: ym })
  }
  return `SP${ym}${String(n).padStart(4, '0')}`
}

function mapStatus(s) {
  const m = { UNPAID: 'pending', READY_TO_SHIP: 'confirmed', PROCESSED: 'packing', SHIPPED: 'shipped', COMPLETED: 'delivered', CANCELLED: 'cancelled', TO_RETURN: 'returned' }
  return m[s] || 'pending'
}

// ─── Auth URL (no access_token in sign for shop-level auth) ──────────────────
function shopeeAuthSign(partnerKey, partnerId, apiPath, ts) {
  const base = `${partnerId}${apiPath}${ts}`
  return crypto.createHmac('sha256', partnerKey).update(base).digest('hex')
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// OAuth step 1: redirect to Shopee login
router.get('/auth/:storeId', requireAuth, async (req, res) => {
  try {
    const { data: store } = await supabaseAdmin.from('ecommerce_stores').select('*').eq('id', req.params.storeId).single()
    if (!store) { req.flash('error', 'ไม่พบร้านค้า'); return res.redirect('/shopee') }

    const { data: cfg } = await supabaseAdmin.from('settings').select('key,value')
    const settings = {}
    ;(cfg || []).forEach(r => { settings[r.key] = r.value })
    const appUrl = (settings.app_url || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '')

    const pid  = store.channel_id
    const pkey = store.channel_secret
    const ts   = Math.floor(Date.now() / 1000)
    const apiPath = '/api/v2/shop/auth_partner'
    const sign = shopeeAuthSign(pkey, pid, apiPath, ts)
    const redirect = `${appUrl}/shopee/callback`

    req.session.shopeeAuthStoreId = store.id

    const authUrl = `https://partner.shopeemobile.com${apiPath}?partner_id=${pid}&redirect=${encodeURIComponent(redirect)}&timestamp=${ts}&sign=${sign}`
    res.redirect(authUrl)
  } catch (err) {
    console.error('Shopee auth error:', err)
    req.flash('error', `สร้าง Auth URL ไม่สำเร็จ: ${err.message}`)
    res.redirect('/shopee')
  }
})

// OAuth step 2: callback — exchange code for access_token
router.get('/callback', requireAuth, async (req, res) => {
  const { code, shop_id } = req.query
  const storeId = req.session.shopeeAuthStoreId

  if (!storeId || !code || !shop_id) {
    req.flash('error', 'OAuth ล้มเหลว: ข้อมูลไม่ครบ (code หรือ shop_id หายไป)')
    return res.redirect('/shopee')
  }

  try {
    const { data: store } = await supabaseAdmin.from('ecommerce_stores').select('*').eq('id', storeId).single()
    if (!store) throw new Error('ไม่พบร้านค้าใน database')

    const pid  = store.channel_id
    const pkey = store.channel_secret
    const ts   = Math.floor(Date.now() / 1000)
    const apiPath = '/api/v2/auth/token/get'
    const sign = shopeeAuthSign(pkey, pid, apiPath, ts)
    const body = JSON.stringify({ code, shop_id: parseInt(shop_id), partner_id: parseInt(pid) })

    const tokenResp = await new Promise((resolve, reject) => {
      const opts = {
        hostname: SHOPEE_HOST, port: 443,
        path: `${apiPath}?partner_id=${pid}&timestamp=${ts}&sign=${sign}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
      }
      const r = https.request(opts, res2 => {
        let d = ''
        res2.on('data', c => d += c)
        res2.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } })
      })
      r.on('error', reject)
      r.write(body)
      r.end()
    })

    if (!tokenResp.access_token) throw new Error(tokenResp.message || tokenResp.error || 'ไม่ได้รับ Access Token')

    await supabaseAdmin.from('ecommerce_stores').update({
      shop_id: String(shop_id),
      access_token:  tokenResp.access_token,
      refresh_token: tokenResp.refresh_token || null,
      updated_at: new Date()
    }).eq('id', storeId)

    delete req.session.shopeeAuthStoreId
    req.flash('success', `เชื่อมต่อ Shopee สำเร็จ! Shop ID: ${shop_id} — ได้รับ Access Token แล้ว`)
  } catch (err) {
    console.error('Shopee callback error:', err)
    req.flash('error', `รับ Token ไม่สำเร็จ: ${err.message}`)
  }
  res.redirect('/shopee')
})

router.get('/', requireAuth, async (req, res) => {
  try {
    const [{ data: stores }, { data: orders }] = await Promise.all([
      supabaseAdmin.from('ecommerce_stores').select('*').eq('platform', 'shopee').order('created_at'),
      supabaseAdmin.from('ecommerce_orders')
        .select('*, items:ecommerce_order_items(*), store:ecommerce_stores(store_name)')
        .eq('platform', 'shopee')
        .order('ordered_at', { ascending: false })
        .limit(200)
    ])
    res.render('ecommerce/shopee', {
      title: 'Shopee', activePage: 'ecommerce',
      stores: stores || [], orders: orders || [],
      success: req.flash('success'), error: req.flash('error')
    })
  } catch (err) {
    res.render('ecommerce/shopee', {
      title: 'Shopee', activePage: 'ecommerce',
      stores: [], orders: [], success: [], error: [err.message]
    })
  }
})

// Connect store
router.post('/stores', requireAuth, async (req, res) => {
  const { store_name, partner_id, partner_key, shop_id, access_token, refresh_token, sender_name, sender_phone, sender_address } = req.body
  try {
    const { data: newStore, error } = await supabaseAdmin.from('ecommerce_stores').insert([{
      platform: 'shopee', store_name,
      channel_id: partner_id, channel_secret: partner_key,
      shop_id: shop_id || null,
      access_token: access_token || null,
      refresh_token: refresh_token || null,
      sender_name: sender_name || null, sender_phone: sender_phone || null, sender_address: sender_address || null,
      is_active: true
    }]).select().single()
    if (error) throw error
    if (!access_token) {
      req.flash('success', `บันทึกร้าน "${store_name}" แล้ว — กดปุ่ม "🔑 ขอ Token" เพื่อเชื่อมต่อ Shopee`)
    } else {
      req.flash('success', `เชื่อมต่อร้าน "${store_name}" เรียบร้อยแล้ว`)
    }
  } catch (err) { req.flash('error', `เชื่อมต่อไม่สำเร็จ: ${err.message}`) }
  res.redirect('/shopee')
})

// Update store
router.put('/stores/:id', requireAuth, async (req, res) => {
  const { store_name, partner_id, partner_key, shop_id, access_token, refresh_token, sender_name, sender_phone, sender_address } = req.body
  try {
    const { error } = await supabaseAdmin.from('ecommerce_stores').update({
      store_name, channel_id: partner_id, channel_secret: partner_key,
      shop_id, access_token, refresh_token: refresh_token || null,
      sender_name: sender_name || null, sender_phone: sender_phone || null, sender_address: sender_address || null,
      updated_at: new Date()
    }).eq('id', req.params.id)
    if (error) throw error
    req.flash('success', 'อัปเดตข้อมูลร้านเรียบร้อยแล้ว')
  } catch (err) { req.flash('error', `อัปเดตไม่สำเร็จ: ${err.message}`) }
  res.redirect('/shopee')
})

// Delete store
router.delete('/stores/:id', requireAuth, async (req, res) => {
  await supabaseAdmin.from('ecommerce_stores').delete().eq('id', req.params.id)
  req.flash('success', 'ลบร้านเรียบร้อยแล้ว')
  res.redirect('/shopee')
})

// Sync orders
router.post('/stores/:id/sync', requireAuth, async (req, res) => {
  try {
    const { data: store } = await supabaseAdmin.from('ecommerce_stores').select('*').eq('id', req.params.id).single()
    if (!store) throw new Error('ไม่พบข้อมูลร้าน')

    const days = parseInt(req.body.days) || 7
    const timeFrom = Math.floor(Date.now() / 1000) - days * 86400
    const timeTo   = Math.floor(Date.now() / 1000)

    const listResp = await shopeeCall(store, 'GET', '/api/v2/order/get_order_list', {
      time_range_field: 'create_time', time_from: timeFrom, time_to: timeTo,
      page_size: 100
    })
    if (listResp.error) throw new Error(`Shopee: ${listResp.message || listResp.error}`)

    const orderSns = (listResp.response?.order_list || []).map(o => o.order_sn)
    if (!orderSns.length) { req.flash('success', 'ไม่พบออเดอร์ใหม่'); return res.redirect('/shopee') }

    let synced = 0, skipped = 0
    for (let i = 0; i < orderSns.length; i += 50) {
      const batch = orderSns.slice(i, i + 50)
      const detResp = await shopeeCall(store, 'GET', '/api/v2/order/get_order_detail', {
        order_sn_list: batch.join(','),
        response_optional_fields: 'buyer_username,item_list,recipient_address,payment_method,shipping_carrier,tracking_number,total_amount'
      })

      for (const ord of (detResp.response?.order_list || [])) {
        const { data: ex } = await supabaseAdmin.from('ecommerce_orders')
          .select('id').eq('platform_order_id', ord.order_sn).eq('platform', 'shopee').maybeSingle()
        if (ex) { skipped++; continue }

        const addr = ord.recipient_address || {}
        const order_no = await generateOrderNo()
        const { data: newOrd, error: oErr } = await supabaseAdmin.from('ecommerce_orders').insert([{
          order_no, store_id: store.id, platform: 'shopee',
          platform_order_id: ord.order_sn,
          status: mapStatus(ord.order_status),
          customer_name:  addr.name  || ord.buyer_username || 'ลูกค้า Shopee',
          customer_phone: addr.phone || '',
          customer_address: addr.full_address || '',
          customer_district: addr.district || '',
          customer_province: addr.state    || '',
          customer_postal_code: addr.zipcode || '',
          shipping_provider: ord.shipping_carrier || 'Shopee Express',
          tracking_no: ord.tracking_number || null,
          subtotal:  parseFloat(ord.total_amount) || 0,
          total:     parseFloat(ord.total_amount) || 0,
          payment_method: (ord.payment_method || '').includes('COD') ? 'cod' : 'transfer',
          ordered_at: ord.create_time ? new Date(ord.create_time * 1000) : new Date()
        }]).select().single()

        if (oErr || !newOrd) { console.error('Insert shopee order:', oErr); continue }

        const items = (ord.item_list || []).map(item => ({
          order_id: newOrd.id,
          platform_product_id: String(item.item_id),
          product_name: item.item_name || 'สินค้า',
          sku: item.model_sku || null,
          variant: item.model_name || null,
          qty: item.model_quantity_purchased || 1,
          unit_price: parseFloat(item.model_discounted_price) || 0,
          line_total: (parseFloat(item.model_discounted_price) || 0) * (item.model_quantity_purchased || 1)
        }))
        if (items.length) await supabaseAdmin.from('ecommerce_order_items').insert(items)
        synced++
      }
    }

    await supabaseAdmin.from('ecommerce_stores').update({ last_sync_at: new Date() }).eq('id', store.id)
    req.flash('success', `ซิงค์เสร็จ: นำเข้า ${synced} ออเดอร์, ข้าม ${skipped} ออเดอร์ที่มีอยู่แล้ว`)
  } catch (err) {
    console.error('Shopee sync error:', err)
    req.flash('error', `ซิงค์ไม่สำเร็จ: ${err.message}`)
  }
  res.redirect('/shopee')
})

// Download & proxy label from Shopee API
router.get('/orders/:id/label', requireAuth, async (req, res) => {
  try {
    const { data: order } = await supabaseAdmin.from('ecommerce_orders')
      .select('*, store:ecommerce_stores(*)').eq('id', req.params.id).single()
    if (!order?.store) throw new Error('ไม่พบออเดอร์หรือข้อมูลร้าน')

    const store = order.store
    const sn = order.platform_order_id

    // Step 1: create document
    await shopeeCall(store, 'POST', '/api/v2/logistics/create_shipping_document', {
      order_list: [{ order_sn: sn }]
    })

    // Step 2: download
    const dlResp = await shopeeCall(store, 'POST', '/api/v2/logistics/download_shipping_document', {
      order_list: [{ order_sn: sn }],
      shipping_document_type: 'NORMAL_AIR_WAYBILL'
    })

    if (dlResp.error) throw new Error(`Shopee label error: ${dlResp.message}`)
    const result = dlResp.response?.result_list?.[0]
    if (!result?.file_data) throw new Error('ไม่มีข้อมูล label จาก Shopee')

    const buf = Buffer.from(result.file_data, 'base64')
    const isImage = result.file_type?.toUpperCase() !== 'PDF'
    res.setHeader('Content-Type', isImage ? 'image/png' : 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="shopee_${sn}.${isImage ? 'png' : 'pdf'}"`)
    res.send(buf)
  } catch (err) {
    console.error('Shopee label error:', err)
    res.status(400).send(`<html><body style="font-family:sans-serif;padding:30px;"><h3 style="color:#dc2626">⚠️ ${err.message}</h3><p>กรุณาตรวจสอบ Access Token และ Partner Key</p><a href="/shopee">← กลับ</a></body></html>`)
  }
})

// Update tracking number manually
router.post('/orders/:id/tracking', requireAuth, async (req, res) => {
  const { tracking_no } = req.body
  await supabaseAdmin.from('ecommerce_orders').update({ tracking_no }).eq('id', req.params.id)
  res.json({ ok: true })
})

// Update status
router.post('/orders/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body
  await supabaseAdmin.from('ecommerce_orders').update({ status }).eq('id', req.params.id)
  req.flash('success', 'อัปเดตสถานะเรียบร้อยแล้ว')
  res.redirect('/shopee')
})

module.exports = router
