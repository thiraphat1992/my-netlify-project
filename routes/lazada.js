const express = require('express')
const router = express.Router()
const https = require('https')
const crypto = require('crypto')
const { requireAuth } = require('../middleware/auth')
const { supabaseAdmin } = require('../config/supabase')

const LAZADA_HOST = 'api.lazada.co.th'
const LAZADA_BASE = '/rest'

// ─── Signature ────────────────────────────────────────────────────────────────
function lazadaSign(appSecret, apiPath, params) {
  const sortedKeys = Object.keys(params).sort()
  const str = apiPath + sortedKeys.map(k => `${k}${params[k]}`).join('')
  return crypto.createHmac('sha256', appSecret).update(str).digest('hex').toUpperCase()
}

// ─── HTTP call ────────────────────────────────────────────────────────────────
function lazadaCall(store, apiPath, extraParams = {}) {
  return new Promise((resolve, reject) => {
    const appKey    = store.channel_id
    const appSecret = store.channel_secret
    const tok       = store.access_token
    const ts        = String(Date.now())

    const allParams = { app_key: appKey, timestamp: ts, sign_method: 'sha256', access_token: tok, ...extraParams }
    allParams.sign  = lazadaSign(appSecret, apiPath, allParams)

    const qs = Object.entries(allParams)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')

    const options = {
      hostname: LAZADA_HOST, port: 443,
      path: `${LAZADA_BASE}${apiPath}?${qs}`,
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    }
    const req = https.request(options, res => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(new Error(`Lazada parse error: ${data.slice(0, 300)}`)) }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

// ─── Doc number ───────────────────────────────────────────────────────────────
async function generateOrderNo() {
  const ym = `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}`
  const { data: seq } = await supabaseAdmin.from('doc_sequences').select('*').eq('doc_type', 'lazada_order').single()
  let n = 1
  if (seq) {
    n = (seq.year_month === ym ? seq.last_number : 0) + 1
    await supabaseAdmin.from('doc_sequences').update({ last_number: n, year_month: ym, updated_at: new Date() }).eq('doc_type', 'lazada_order')
  } else {
    await supabaseAdmin.from('doc_sequences').insert({ doc_type: 'lazada_order', prefix: 'LZ', last_number: 1, year_month: ym })
  }
  return `LZ${ym}${String(n).padStart(4, '0')}`
}

function mapStatus(s) {
  const m = { pending: 'pending', ready_to_ship: 'confirmed', shipped: 'shipped', delivered: 'delivered', canceled: 'cancelled', returned: 'returned', failed: 'cancelled' }
  return m[(s || '').toLowerCase()] || 'pending'
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get('/', requireAuth, async (req, res) => {
  try {
    const [{ data: stores }, { data: orders }] = await Promise.all([
      supabaseAdmin.from('ecommerce_stores').select('*').eq('platform', 'lazada').order('created_at'),
      supabaseAdmin.from('ecommerce_orders')
        .select('*, items:ecommerce_order_items(*), store:ecommerce_stores(store_name)')
        .eq('platform', 'lazada')
        .order('ordered_at', { ascending: false })
        .limit(200)
    ])
    res.render('ecommerce/lazada', {
      title: 'Lazada', activePage: 'ecommerce',
      stores: stores || [], orders: orders || [],
      success: req.flash('success'), error: req.flash('error')
    })
  } catch (err) {
    res.render('ecommerce/lazada', {
      title: 'Lazada', activePage: 'ecommerce',
      stores: [], orders: [], success: [], error: [err.message]
    })
  }
})

// Connect store
router.post('/stores', requireAuth, async (req, res) => {
  const { store_name, app_key, app_secret, access_token, refresh_token, sender_name, sender_phone, sender_address } = req.body
  try {
    const { error } = await supabaseAdmin.from('ecommerce_stores').insert([{
      platform: 'lazada', store_name,
      channel_id: app_key, channel_secret: app_secret,
      access_token, refresh_token: refresh_token || null,
      sender_name: sender_name || null, sender_phone: sender_phone || null, sender_address: sender_address || null,
      is_active: true
    }])
    if (error) throw error
    req.flash('success', `เชื่อมต่อร้าน "${store_name}" เรียบร้อยแล้ว`)
  } catch (err) { req.flash('error', `เชื่อมต่อไม่สำเร็จ: ${err.message}`) }
  res.redirect('/lazada')
})

// Update store
router.put('/stores/:id', requireAuth, async (req, res) => {
  const { store_name, app_key, app_secret, access_token, refresh_token, sender_name, sender_phone, sender_address } = req.body
  try {
    const { error } = await supabaseAdmin.from('ecommerce_stores').update({
      store_name, channel_id: app_key, channel_secret: app_secret,
      access_token, refresh_token: refresh_token || null,
      sender_name: sender_name || null, sender_phone: sender_phone || null, sender_address: sender_address || null,
      updated_at: new Date()
    }).eq('id', req.params.id)
    if (error) throw error
    req.flash('success', 'อัปเดตข้อมูลร้านเรียบร้อยแล้ว')
  } catch (err) { req.flash('error', `อัปเดตไม่สำเร็จ: ${err.message}`) }
  res.redirect('/lazada')
})

// Delete store
router.delete('/stores/:id', requireAuth, async (req, res) => {
  await supabaseAdmin.from('ecommerce_stores').delete().eq('id', req.params.id)
  req.flash('success', 'ลบร้านเรียบร้อยแล้ว')
  res.redirect('/lazada')
})

// Sync orders
router.post('/stores/:id/sync', requireAuth, async (req, res) => {
  try {
    const { data: store } = await supabaseAdmin.from('ecommerce_stores').select('*').eq('id', req.params.id).single()
    if (!store) throw new Error('ไม่พบข้อมูลร้าน')

    const days = parseInt(req.body.days) || 7
    const createdAfter = new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19)

    // Get order list
    const listResp = await lazadaCall(store, '/orders/get', {
      created_after: createdAfter, limit: '100', offset: '0',
      sort_by: 'created_at', sort_direction: 'DESC'
    })
    if (listResp.code !== '0') throw new Error(`Lazada API: ${listResp.message || listResp.code}`)

    const orders = listResp.data?.orders || []
    if (!orders.length) { req.flash('success', 'ไม่พบออเดอร์ใหม่'); return res.redirect('/lazada') }

    let synced = 0, skipped = 0

    for (const ord of orders) {
      const orderId = String(ord.order_id)
      const { data: ex } = await supabaseAdmin.from('ecommerce_orders')
        .select('id').eq('platform_order_id', orderId).eq('platform', 'lazada').maybeSingle()
      if (ex) { skipped++; continue }

      // Get order items
      const itemsResp = await lazadaCall(store, '/order/items/get', { order_id: orderId })
      const itemList  = itemsResp.data || []

      const addr       = ord.address_shipping || {}
      const order_no   = await generateOrderNo()
      const totalAmt   = parseFloat(ord.price) || 0
      const shippingFee = parseFloat(ord.shipping_fee_original) || 0

      const { data: newOrd, error: oErr } = await supabaseAdmin.from('ecommerce_orders').insert([{
        order_no, store_id: store.id, platform: 'lazada',
        platform_order_id: orderId,
        status: mapStatus(ord.statuses?.[0] || ord.status),
        customer_name:  `${addr.first_name || ''} ${addr.last_name || ''}`.trim() || 'ลูกค้า Lazada',
        customer_phone: addr.phone || addr.phone2 || '',
        customer_address: [addr.address1, addr.address2, addr.address3, addr.address4, addr.address5].filter(Boolean).join(' '),
        customer_district: addr.city      || '',
        customer_province: addr.country   || '',
        customer_postal_code: addr.post_code || '',
        shipping_provider: ord.delivery_info || 'LEX TH',
        tracking_no: null,
        subtotal: totalAmt, total: totalAmt + shippingFee,
        shipping_fee: shippingFee,
        payment_method: (ord.payment_method || '').includes('COD') ? 'cod' : 'transfer',
        ordered_at: ord.created_at ? new Date(ord.created_at) : new Date()
      }]).select().single()

      if (oErr || !newOrd) { console.error('Insert lazada order:', oErr); continue }

      const items = itemList.map(item => ({
        order_id: newOrd.id,
        platform_product_id: String(item.product_id || item.item_id || ''),
        product_name: item.name || 'สินค้า',
        sku: item.sku || null,
        variant: item.variation || null,
        qty: parseInt(item.units) || 1,
        unit_price: parseFloat(item.unit_price) || 0,
        line_total: parseFloat(item.paid_price) || (parseFloat(item.unit_price) || 0) * (parseInt(item.units) || 1)
      }))
      if (items.length) await supabaseAdmin.from('ecommerce_order_items').insert(items)
      synced++
    }

    await supabaseAdmin.from('ecommerce_stores').update({ last_sync_at: new Date() }).eq('id', store.id)
    req.flash('success', `ซิงค์เสร็จ: นำเข้า ${synced} ออเดอร์, ข้าม ${skipped} ออเดอร์ที่มีอยู่แล้ว`)
  } catch (err) {
    console.error('Lazada sync error:', err)
    req.flash('error', `ซิงค์ไม่สำเร็จ: ${err.message}`)
  }
  res.redirect('/lazada')
})

// Proxy shipping document (label) from Lazada
router.get('/orders/:id/label', requireAuth, async (req, res) => {
  try {
    const { data: order } = await supabaseAdmin.from('ecommerce_orders')
      .select('*, items:ecommerce_order_items(*), store:ecommerce_stores(*)').eq('id', req.params.id).single()
    if (!order?.store) throw new Error('ไม่พบออเดอร์หรือข้อมูลร้าน')

    const store = order.store
    const itemIds = (order.items || []).map(i => i.platform_product_id).filter(Boolean)
    if (!itemIds.length) throw new Error('ไม่พบ Item ID สำหรับ Lazada label')

    // Get document URL
    const docResp = await lazadaCall(store, '/order/document/get', {
      doc_type: 'shippingLabel',
      order_item_id: itemIds.join(',')
    })

    if (docResp.code !== '0') throw new Error(`Lazada label error: ${docResp.message}`)

    const docUrl = docResp.data?.document?.file
    if (!docUrl) throw new Error('ไม่มี URL label จาก Lazada')

    // Proxy the PDF/image
    const urlObj = new URL(docUrl)
    const proto  = urlObj.protocol === 'https:' ? https : require('http')
    proto.get(docUrl, docRes => {
      res.setHeader('Content-Type', docRes.headers['content-type'] || 'application/pdf')
      res.setHeader('Content-Disposition', `inline; filename="lazada_${order.platform_order_id}.pdf"`)
      docRes.pipe(res)
    }).on('error', err => { throw err })
  } catch (err) {
    console.error('Lazada label error:', err)
    res.status(400).send(`<html><body style="font-family:sans-serif;padding:30px;"><h3 style="color:#dc2626">⚠️ ${err.message}</h3><p>กรุณาตรวจสอบ App Key และ App Secret</p><a href="/lazada">← กลับ</a></body></html>`)
  }
})

// Update status
router.post('/orders/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body
  await supabaseAdmin.from('ecommerce_orders').update({ status }).eq('id', req.params.id)
  req.flash('success', 'อัปเดตสถานะเรียบร้อยแล้ว')
  res.redirect('/lazada')
})

module.exports = router
