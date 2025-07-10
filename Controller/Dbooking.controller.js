const { Pool } = require('pg');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
});

const ACCESS_TOKEN = 'EAAKZAUdN55kEBPCVvsNNZBMg38VsJsBcpEIYNnYqTitiZAUOBu0DHZC326LV4QslYX00y1oOnCMF0V1JzJLeJRIlKBbGpZA994coQ1ALIJq0DC4Xugmo8r0GhRvdsxJgHmduoG4fYcmidjBb55TQR50ncqktQMM7Ked1g4vOa2Dj9d5HGgXFEVMQYZA6ieDkBGPZCLW3lhFSvjDCL1eR9BRvz3UJJkYnggAGuT47ZB2AzRAZD';
const PHONE_NUMBER_ID = '660922473779560';

const generateInvoicePDF = (bookingData, customerDetails, products) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const safeCustomerName = customerDetails.customer_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const pdfPath = path.join(__dirname, '../pdf_data', `${safeCustomerName}-${bookingData.order_id}.pdf`);
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    doc.fontSize(20).font('Helvetica-Bold').text('Phoenix Crackers', 50, 50);
    doc.fontSize(12).font('Helvetica').text('Location: Phoenix Crackers, Anil kumar Eye Hospital Opp, Sattur Road, Sivakasi', 50, 80);
    doc.text('Mobile Number: +91 63836 59214', 50, 95);
    doc.text('Email Address: nivasramasamy27@gmail.com', 50, 110);
    
    doc.fontSize(16).font('Helvetica-Bold').text('Invoice', 50, 150);
    
    doc.fontSize(12).font('Helvetica')
      .text(`Customer Name: ${customerDetails.customer_name || 'N/A'}`, 50, 180)
      .text(`Company Name: ${customerDetails.company_name || 'N/A'}`, 50, 195)
      .text(`License Number: ${customerDetails.license_number || 'N/A'}`, 50, 210)
      .text(`Address: ${customerDetails.address || 'N/A'}`, 50, 225)
      .text(`District: ${customerDetails.district || 'N/A'}`, 50, 240)
      .text(`State: ${customerDetails.state || 'N/A'}`, 50, 255)
      .text(`Order ID: ${bookingData.order_id}`, 50, 270);

    const tableY = 300;
    doc.fontSize(10).font('Helvetica-Bold')
      .text('Product', 50, tableY)
      .text('Quantity', 250, tableY)
      .text('Price', 350, tableY)
      .text('Total', 450, tableY);
    
    let y = tableY + 25;
    let total = 0;
    products.forEach((product, index) => {
      const price = parseFloat(product.price);
      const discount = parseFloat(product.discount || 0);
      const priceAfterDiscount = price - (price * (discount / 100));
      const productTotal = priceAfterDiscount * product.quantity;
      total += productTotal;
      doc.font('Helvetica')
        .text(product.productname, 50, y)
        .text(product.quantity.toString(), 250, y)
        .text(`Rs.${priceAfterDiscount.toFixed(2)}`, 350, y)
        .text(`Rs.${productTotal.toFixed(2)}`, 450, y);
      y += 20;
      if (index < products.length - 1) {
        doc.moveTo(50, y - 5).lineTo(550, y - 5).stroke();
      }
    });

    doc.font('Helvetica-Bold').text(`Total: Rs.${total.toFixed(2)}`, 450, y + 20);

    doc.end();
    
    stream.on('finish', () => resolve(pdfPath));
    stream.on('error', (err) => reject(err));
  });
};

async function uploadPDF(pdfPath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(pdfPath));
  form.append('type', 'application/pdf');
  form.append('messaging_product', 'whatsapp');

  const res = await axios.post(
    `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/media`,
    form,
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        ...form.getHeaders(),
      },
    }
  );
  return res.data.id;
}

async function sendTemplateWithPDF(mediaId, total, customerDetails) {
  let recipientNumber = customerDetails.mobile_number;
  if (!recipientNumber) {
    throw new Error('Mobile number is missing');
  }
  recipientNumber = recipientNumber.replace(/\s+/g, '');
  if (!recipientNumber.startsWith('+')) {
    if (recipientNumber.length === 10) {
      recipientNumber = `+91${recipientNumber}`;
    } else if (recipientNumber.length === 12 && recipientNumber.startsWith('91')) {
      recipientNumber = `+${recipientNumber}`;
    } else {
      throw new Error('Invalid mobile number format');
    }
  }

  const payload = {
    messaging_product: 'whatsapp',
    to: recipientNumber,
    type: 'template',
    template: {
      name: 'purchase_receipt',
      language: { code: 'en_US' },
      components: [
        {
          type: 'header',
          parameters: [
            {
              type: 'document',
              document: {
                id: mediaId,
                filename: 'booking_details.pdf',
              },
            },
          ],
        },
        {
          type: 'body',
          parameters: [
            { type: 'text', text: `Rs.${parseFloat(total).toFixed(2)}` },
            { type: 'text', text: 'Phoenix Crackers, Anil kumar Eye Hospital Opp, Sattur Road, Sivakasi' },
            { type: 'text', text: 'Booking' },
          ],
        },
      ],
    },
  };

  await axios.post(
    `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

exports.createDBooking = async (req, res) => {
  try {
    const { customer_name, company_name, license_number, address, mobile_number, email, district, state, products, total } = req.body;

    if (!customer_name || !company_name || !address || !district || !state || !products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: 'All required fields and a non-empty products array are required' });
    }

    if (mobile_number && !/^\d{10,}$/.test(mobile_number.replace(/\s+/g, ''))) {
      return res.status(400).json({ message: 'Invalid mobile number format' });
    }

    if (email && !/^[\w-.]+@([\w-]+\.)+[\w-]{2,4}$/.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    const order_id = `DORD-${Date.now()}`;

    // Validate and log products
    console.log('Received products:', products);
    let validProducts = [];
    try {
      validProducts = products.map(p => {
        if (!p.id || typeof p.quantity !== 'number' || p.quantity < 1 || p.product_type !== 'gift_box_dealers' || !p.productname || typeof p.price !== 'number') {
          throw new Error(`Invalid product data: ${JSON.stringify(p)}`);
        }
        return { id: p.id, quantity: p.quantity, product_type: p.product_type, productname: p.productname, price: p.price, discount: parseFloat(p.discount || 0) };
      });
      if (validProducts.length === 0) {
        throw new Error('No valid products provided');
      }
    } catch (e) {
      return res.status(400).json({ message: `Invalid products data: ${e.message}` });
    }

    for (const product of validProducts) {
      const { id, quantity, product_type } = product;
      const productCheck = await pool.query(
        `SELECT id, stock FROM public.gift_box_dealers WHERE id = $1 AND status = 'on'`,
        [id]
      );
      if (productCheck.rows.length === 0) {
        return res.status(404).json({ message: `Product ${id} not found or not available` });
      }
      if (quantity > productCheck.rows[0].stock) {
        return res.status(400).json({ message: `Insufficient stock for product ${id}` });
      }
    }

    for (const product of validProducts) {
      const { id, quantity } = product;
      await pool.query(
        `UPDATE public.gift_box_dealers SET stock = stock - $1 WHERE id = $2`,
        [quantity, id]
      );
    }

    const customerDetails = { customer_name, company_name, license_number, address, mobile_number, email, district, state };
    const pdfPath = await generateInvoicePDF({ order_id, total }, customerDetails, validProducts);

    const query = `
      INSERT INTO public.dboooking (
        order_id, customer_name, company_name, license_number, address, mobile_number, email, district, state, products, total, status, pdf
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id, order_id, created_at, pdf
    `;
    const values = [
      order_id,
      customer_name,
      company_name,
      license_number || null,
      address,
      mobile_number || null,
      email || null,
      district,
      state,
      JSON.stringify(validProducts),
      parseFloat(total),
      'booked',
      pdfPath
    ];
    const result = await pool.query(query, values);

    try {
      const mediaId = await uploadPDF(pdfPath);
      await sendTemplateWithPDF(mediaId, total, customerDetails);
    } catch (err) {
      console.error('WhatsApp PDF sending failed:', err);
    }

    res.status(201).json({
      message: 'Booking created successfully',
      id: result.rows[0].id,
      order_id: result.rows[0].order_id,
      created_at: result.rows[0].created_at,
      pdf_path: result.rows[0].pdf
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to create booking', error: err.message });
  }
};

exports.getDBookingInvoice = async (req, res) => {
  try {
    let { order_id } = req.params;
    if (order_id.endsWith('.pdf')) {
      order_id = order_id.replace(/\.pdf$/, '');
    }
    if (!/^[a-zA-Z0-9-_]+$/.test(order_id)) {
      return res.status(400).json({ message: 'Invalid order_id format' });
    }

    const bookingQuery = await pool.query(
      'SELECT customer_name, company_name, license_number, address, mobile_number, email, district, state, products, total, pdf FROM public.dboooking WHERE order_id = $1',
      [order_id]
    );

    if (bookingQuery.rows.length === 0) {
      return res.status(404).json({ message: `No booking found for order_id '${order_id}'` });
    }

    const { customer_name, company_name, license_number, address, mobile_number, email, district, state, products, total, pdf } = bookingQuery.rows[0];

    if (!fs.existsSync(pdf)) {
      const regeneratedPdfPath = await generateInvoicePDF(
        { order_id, total },
        { customer_name, company_name, license_number, address, mobile_number, email, district, state },
        JSON.parse(products)
      );
      await pool.query('UPDATE public.dboooking SET pdf = $1 WHERE order_id = $2', [regeneratedPdfPath, order_id]);
    }

    const safeCustomerName = customer_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${safeCustomerName}-${order_id}.pdf`);
    fs.createReadStream(pdf).pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch invoice', error: err.message });
  }
};

exports.getProducts = async (req, res) => {
  try {
    const query = `
      SELECT id, serial_number, productname, price, per, discount, stock, image, status, fast_running
      FROM public.gift_box_dealers
      WHERE status = 'on' AND stock > 0
    `;
    const result = await pool.query(query);
    const products = result.rows.map(row => ({
      id: row.id,
      product_type: 'gift_box_dealers',
      serial_number: row.serial_number,
      productname: row.productname,
      price: row.price,
      per: row.per,
      discount: row.discount,
      stock: row.stock,
      image: row.image,
      status: row.status,
      fast_running: row.fast_running
    }));
    res.status(200).json(products);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch products' });
  }
};

exports.bookProduct = async (req, res) => {
  try {
    const { tableName, id } = req.params;
    const { quantity } = req.body;

    if (tableName !== 'gift_box_dealers') {
      return res.status(400).json({ message: 'Booking is only available for gift_box_dealers' });
    }

    if (!quantity || quantity <= 0) {
      return res.status(400).json({ message: 'Valid quantity is required' });
    }

    const product = await pool.query(
      `SELECT stock FROM public.${tableName} WHERE id = $1`,
      [id]
    );

    if (product.rows.length === 0) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const currentStock = product.rows[0].stock;
    if (quantity > currentStock) {
      return res.status(400).json({ message: 'Insufficient stock' });
    }

    const newStock = currentStock - quantity;
    await pool.query(
      `UPDATE public.${tableName} SET stock = $1 WHERE id = $2`,
      [newStock, id]
    );

    res.status(200).json({ message: 'Product booked successfully', newStock });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to book product' });
  }
};

exports.getBookings = async (req, res) => {
  try {
    const query = `
      SELECT 
        id, 
        order_id, 
        customer_name, 
        company_name, 
        license_number, 
        address, 
        mobile_number, 
        email, 
        district, 
        state, 
        products, 
        total, 
        created_at 
      FROM public.dboooking
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query);

    const bookings = result.rows.map(row => ({
      id: row.id,
      order_id: row.order_id,
      customer_name: row.customer_name,
      phone_number: row.mobile_number,
      district: row.district,
      state: row.state,
      products: row.products, // Return raw JSON object directly
      total: row.total,
      created_at: row.created_at,
      address: row.address,
    }));

    res.status(200).json(bookings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch bookings', error: err.message });
  }
};