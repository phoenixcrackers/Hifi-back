const { Pool } = require('pg');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const multer = require('multer');

const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const pdfDir = path.join(__dirname, '../pdf_data');
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
    cb(null, pdfDir);
  },
  filename: (req, file, cb) => {
    const { customer_name, order_id } = req.body;
    const safeCustomerName = customer_name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    cb(null, `${safeCustomerName}-${order_id}.pdf`);
  }
});
const upload = multer({ storage });

const generateInvoicePDF = (bookingData, customerDetails, products, extraCharges = {}) => {
  return new Promise((resolve, reject) => {
    // Input validation
    if (!bookingData || !customerDetails || !Array.isArray(products)) {
      return reject(new Error('Invalid input: bookingData, customerDetails, and products are required'));
    }

    const doc = new PDFDocument({ margin: 50 });
    const safeCustomerName = (customerDetails.customer_name || 'unknown')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const pdfPath = path.join(__dirname, '../pdf_data', `${safeCustomerName}-${bookingData.order_id || 'unknown'}.pdf`);
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('Invoice', 50, 50, { align: 'center' });
    doc.fontSize(12).font('Helvetica')
      .text('Hifi Pyro Park', 50, 80, {align:'center'})
      .text('Anil Kumar Eye Hospital Opp, Sattur Road, Sivakasi', 50, 95, {align:'center'})
      .text('Mobile: +91 63836 59214', 50, 110, {align:'center'})
      .text('Email: nivasramasamy27@gmail.com', 50, 125, {align:'center'});

    // Customer Details (Left and Right)
    doc.fontSize(12).font('Helvetica')
      .text(`Customer: ${customerDetails.customer_name || 'N/A'}`, 50, 160)
      .text(`Contact: ${customerDetails.mobile_number || 'N/A'}`, 50, 175)
      .text(`Address: ${customerDetails.address || 'N/A'}`, 50, 190)
      .text(`District: ${customerDetails.district || 'N/A'}`, 300, 160, { align: 'right' })
      .text(`State: ${customerDetails.state || 'N/A'}`, 300, 175, { align: 'right' })
      .text(`Customer Type: ${bookingData.customer_type || 'User'}`, 300, 190, { align: 'right' })
      .text(`Order ID: ${bookingData.order_id || 'N/A'}`, 300, 205, { align: 'right' });

    // Table Header
    const tableY = 250;
    const tableWidth = 500;
    const colWidths = [50, 150, 80, 80, 60, 80]; // Sl No, Product, Quantity, Price, Per, Total
    const colX = [50, 100, 250, 330, 410, 470]; // X positions for columns

    // Draw table top border
    doc.moveTo(50, tableY - 5).lineTo(50 + tableWidth, tableY - 5).stroke();

    // Table Header
    doc.fontSize(10).font('Helvetica-Bold')
      .text('Sl No', colX[0] + 5, tableY, { width: colWidths[0] - 10, align: 'center' })
      .text('Product', colX[1] + 5, tableY, { width: colWidths[1] - 10, align: 'center' })
      .text('Quantity', colX[2] + 5, tableY, { width: colWidths[2] - 10, align: 'center' })
      .text('Price', colX[3] + 5, tableY, { width: colWidths[3] - 10, align: 'center' })
      .text('Per', colX[4] + 5, tableY, { width: colWidths[4] - 10, align: 'center' })
      .text('Total', colX[5] + 5, tableY, { width: colWidths[5] - 10, align: 'center' });

    // Draw header bottom border
    doc.moveTo(50, tableY + 15).lineTo(50 + tableWidth, tableY + 15).stroke();

    // Draw vertical lines for header
    colX.forEach((x, i) => {
      doc.moveTo(x, tableY - 5).lineTo(x, tableY + 15).stroke();
      if (i === colX.length - 1) {
        doc.moveTo(x + colWidths[i], tableY - 5).lineTo(x + colWidths[i], tableY + 15).stroke();
      }
    });

    // Table Rows
    let y = tableY + 25;
    let total = 0;
    products.forEach((product, index) => {
      const price = parseFloat(product.price) || 0;
      const discount = parseFloat(product.discount || 0);
      const productTotal = (price - (price * discount / 100)) * (product.quantity || 0);
      total += productTotal;

      // Draw row content
      doc.font('Helvetica')
        .text(index + 1, colX[0] + 5, y, { width: colWidths[0] - 10, align: 'center' })
        .text(product.productname || 'N/A', colX[1] + 5, y, { width: colWidths[1] - 10, align: 'center' })
        .text(product.quantity || 0, colX[2] + 5, y, { width: colWidths[2] - 10, align: 'center' })
        .text(`Rs.${price.toFixed(2)}`, colX[3] + 5, y, { width: colWidths[3] - 10, align: 'center' })
        .text(product.per || 'N/A', colX[4] + 5, y, { width: colWidths[4] - 10, align: 'center' })
        .text(`Rs.${productTotal.toFixed(2)}`, colX[5] + 5, y, { width: colWidths[5] - 10, align: 'center' });

      // Draw row bottom border
      doc.moveTo(50, y + 15).lineTo(50 + tableWidth, y + 15).stroke();

      // Draw vertical lines for row
      colX.forEach((x, i) => {
        doc.moveTo(x, y - 5).lineTo(x, y + 15).stroke();
        if (i === colX.length - 1) {
          doc.moveTo(x + colWidths[i], y - 5).lineTo(x + colWidths[i], y + 15).stroke();
        }
      });

      y += 20;
    });

    // Extra Charges (only if present)
    y += 10;
    const tax = parseFloat(extraCharges.tax || 0);
    const pf = parseFloat(extraCharges.pf || 0);
    const minus = parseFloat(extraCharges.minus || 0);
    if (tax > 0 || pf > 0 || minus > 0) {
      let extraChargesText = '';
      if (tax > 0) extraChargesText += `Tax: Rs.${tax.toFixed(2)}  `;
      if (pf > 0) extraChargesText += `P&F: Rs.${pf.toFixed(2)}  `;
      if (minus > 0) extraChargesText += `Deduction: -Rs.${minus.toFixed(2)}  `;
      doc.font('Helvetica').text(extraChargesText.trim(), 450, y, { align: 'right' });
      y += 20;
      total = total + tax + pf - minus;
    }

    // Grand Total
    doc.font('Helvetica-Bold').text(`Grand Total: Rs.${total.toFixed(2)}`, 450, y, { align: 'right' });

    doc.end();
    stream.on('finish', () => resolve({ pdfPath, calculatedTotal: total }));
    stream.on('error', (err) => reject(err));
  });
};

exports.getAdmins = async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, bank_name FROM public.admin');
    const admins = await Promise.all(result.rows.map(async admin => {
      try {
        const total = await pool.query('SELECT COALESCE(SUM(amount_paid), 0) as total FROM public.payment_transactions WHERE admin_id = $1', [admin.id]);
        return { ...admin, total: total.rows[0].total };
      } catch (err) {
        console.error(`Error calculating total for admin ${admin.id}:`, err);
        return { ...admin, total: 0 }; // Default to 0 on error
      }
    }));
    res.status(200).json(admins);
  } catch (err) {
    console.error('Error in getAdmins:', err);
    res.status(500).json({ message: 'Failed to fetch admins', error: err.message });
  }
};

exports.getAdminTransactions = async (req, res) => {
  try {
    const { adminId } = req.params;
    const result = await pool.query(
      `SELECT pt.amount_paid, pt.payment_method, pt.transaction_date, d.customer_name 
       FROM public.payment_transactions pt 
       LEFT JOIN public.dbooking d ON pt.booking_id = d.id 
       WHERE pt.admin_id = $1 
       ORDER BY pt.transaction_date DESC`,
      [adminId]
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error in getAdminTransactions:', err);
    res.status(500).json({ message: 'Failed to fetch transactions', error: err.message });
  }
};

exports.getBookings = async (req, res) => {
  try {
    const { status } = req.query;

    // Build the query parts
    const selectPart = `
      SELECT 
        d.id, d.customer_id, d.order_id, d.products, d.total, d.address, d.mobile_number, 
        d.customer_name, d.email, d.district, d.state, d.customer_type, d.status, 
        d.created_at, d.pdf, d.payment_method, d.amount_paid, d.admin_id, 
        d.transport_type, d.transport_name, d.transport_contact, d.lr_number, 
        d.transaction_date, a.username AS admin_username
    `;
    const fromPart = `
      FROM public.dbooking d
      LEFT JOIN public.admin a ON d.admin_id = a.id
    `;
    const wherePart = status && status.trim() !== '' ? ' WHERE d.status = $1' : '';
    const orderPart = ' ORDER BY d.created_at DESC';

    // Combine query parts
    const query = [selectPart, fromPart, wherePart, orderPart].join(' ').trim();
    const params = status && status.trim() !== '' ? [status] : [];

    const result = await pool.query(query, params);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error in getBookings:', err);
    res.status(500).json({ message: 'Failed to fetch bookings', error: err.message });
  }
};

exports.getTransactions = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const result = await pool.query(
      'SELECT amount_paid, payment_method, admin_id, transaction_date FROM public.payment_transactions WHERE booking_id = $1 ORDER BY transaction_date DESC',
      [bookingId]
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error in getTransactions:', err);
    res.status(500).json({ message: 'Failed to fetch transactions', error: err.message });
  }
};

exports.updateBookingStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, payment_method, amount_paid, admin_id, transport_type, transport_name, transport_contact, lr_number } = req.body;

    const booking = await pool.query('SELECT total, amount_paid FROM public.dbooking WHERE id = $1', [id]);
    if (booking.rows.length === 0) throw new Error('Booking not found');
    const currentTotal = parseFloat(booking.rows[0].total) || 0;
    const currentPaid = parseFloat(booking.rows[0].amount_paid) || 0;
    const newPaid = currentPaid + (amount_paid ? parseFloat(amount_paid) : 0);

    // Start transaction to ensure consistency
    await pool.query('BEGIN');

    // Update booking status, payment_method, amount_paid, and admin_id
    // Note: The 'total' column is NOT modified to preserve the initial booking total
    let updateQuery = `
      UPDATE public.dbooking
      SET status = $1, payment_method = $2, amount_paid = $3, admin_id = $4,
          transaction_date = NOW()
    `;
    const updateValues = [status, payment_method, newPaid, admin_id];
    let paramCount = 5;

    if (status === 'dispatched' && transport_type) {
      updateQuery += `, transport_type = $${paramCount++}`;
      updateValues.push(transport_type);
      if (transport_type === 'transport') {
        updateQuery += `, transport_name = $${paramCount++}, transport_contact = $${paramCount++}, lr_number = $${paramCount++}`;
        updateValues.push(transport_name || null, transport_contact || null, lr_number || null);
      } else {
        updateQuery += `, transport_name = NULL, transport_contact = NULL, lr_number = NULL`;
      }
    }

    updateQuery += ` WHERE id = $${paramCount} RETURNING *`;
    updateValues.push(id);

    const result = await pool.query(updateQuery, updateValues);

    // Insert transaction record into payment_transactions if a payment is made
    if (amount_paid) {
      const transactionQuery = `
        INSERT INTO public.payment_transactions (booking_id, amount_paid, payment_method, admin_id, transaction_date)
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING *
      `;
      const transactionValues = [id, parseFloat(amount_paid), payment_method, admin_id];
      await pool.query(transactionQuery, transactionValues);
    }

    await pool.query('COMMIT');

    res.status(200).json({ message: 'Status updated', booking: result.rows[0] });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Error in updateBookingStatus:', err);
    res.status(500).json({ message: 'Failed to update status', error: err.message });
  }
};

exports.createBooking = async (req, res) => {
  try {
    const { customer_id, products, total, customer_type, customer_name, address, mobile_number, email, district, state, payment_method, amount_paid, admin_id } = req.body;

    // Generate order_id automatically in the format DORD-timestamp
    const order_id = `ORD-${Date.now()}`;

    if (!products || !Array.isArray(products) || products.length === 0) return res.status(400).json({ message: 'Products array is required and must not be empty' });
    if (!total || total <= 0) return res.status(400).json({ message: 'Total must be a positive number' });
    if (payment_method && !['cash', 'bank'].includes(payment_method)) return res.status(400).json({ message: 'Invalid payment method' });
    if (payment_method && (!amount_paid || amount_paid <= 0)) return res.status(400).json({ message: 'Amount paid must be a positive number when payment method is provided' });
    if (payment_method && !admin_id) return res.status(400).json({ message: 'Admin ID is required when payment method is provided' });

    let finalCustomerType = customer_type || 'User';
    let customerDetails = { customer_name, address, mobile_number, email, district, state };

    if (customer_id) {
      const customerCheck = await pool.query(
        'SELECT id, customer_name, address, mobile_number, email, district, state, customer_type FROM public.gbcustomers WHERE id = $1',
        [customer_id]
      );
      if (customerCheck.rows.length === 0) return res.status(404).json({ message: 'Customer not found' });
      const { customer_name: db_name, address: db_address, mobile_number: db_mobile, email: db_email, district: db_district, state: db_state, customer_type: dbCustomerType } = customerCheck.rows[0];
      finalCustomerType = customer_type || dbCustomerType || 'User';
      customerDetails = { customer_name: db_name, address: db_address, mobile_number: db_mobile, email: db_email, district: db_district, state: db_state };
    } else {
      if (finalCustomerType !== 'User') return res.status(400).json({ message: 'Customer type must be "User" for bookings without customer ID' });
      if (!customer_name) return res.status(400).json({ message: 'Customer name is required' });
      if (!address) return res.status(400).json({ message: 'Address is required' });
      if (!district) return res.status(400).json({ message: 'District is required' });
      if (!state) return res.status(400).json({ message: 'State is required' });
      if (!mobile_number) return res.status(400).json({ message: 'Mobile number is required' });
      if (!email) return res.status(400).json({ message: 'Email is required' });
    }

    for (const product of products) {
      const { id, product_type, quantity } = product;
      if (!id || !product_type || !quantity || quantity < 1) return res.status(400).json({ message: 'Each product must have a valid ID, product type, and positive quantity' });
      const tableName = product_type.toLowerCase().replace(/\s+/g, '_');
      const productCheck = await pool.query(`SELECT id FROM public.${tableName} WHERE id = $1 AND status = 'on'`, [id]);
      if (productCheck.rows.length === 0) return res.status(404).json({ message: `Product ${id} of type ${product_type} not found or not available` });
    }

    const pdfPath = await generateInvoicePDF({ order_id, customer_type: finalCustomerType, total }, customerDetails, products);

    // Start transaction to ensure consistency
    await pool.query('BEGIN');

    // Insert booking with initial total, which will not be modified later
    const bookingQuery = `
      INSERT INTO public.dbooking (customer_id, order_id, products, total, address, mobile_number, customer_name, email, district, state, customer_type, status, created_at, pdf, payment_method, amount_paid, admin_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13, $14, $15, $16)
      RETURNING id, created_at, customer_type, pdf, order_id
    `;
    const bookingValues = [
      customer_id || null, order_id, JSON.stringify(products), parseFloat(total),
      customerDetails.address || null, customerDetails.mobile_number || null,
      customerDetails.customer_name || null, customerDetails.email || null,
      customerDetails.district || null, customerDetails.state || null,
      finalCustomerType, 'booked', pdfPath, payment_method || null, parseFloat(amount_paid) || 0, admin_id || null
    ];
    const bookingResult = await pool.query(bookingQuery, bookingValues);

    // If payment is made, insert into payment_transactions table
    if (payment_method && amount_paid) {
      const transactionQuery = `
        INSERT INTO public.payment_transactions (booking_id, amount_paid, payment_method, admin_id, transaction_date)
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING *
      `;
      const transactionValues = [bookingResult.rows[0].id, parseFloat(amount_paid), payment_method, admin_id];
      await pool.query(transactionQuery, transactionValues);
    }

    await pool.query('COMMIT');

    res.status(201).json({
      message: 'Booking created successfully',
      id: bookingResult.rows[0].id,
      created_at: bookingResult.rows[0].created_at,
      customer_type: bookingResult.rows[0].customer_type,
      pdf_path: bookingResult.rows[0].pdf,
      order_id: bookingResult.rows[0].order_id
    });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ message: 'Failed to create booking', error: err.message });
  }
};

exports.getInvoice = async (req, res) => {
  try {
    let { order_id } = req.params;
    if (order_id.endsWith('.pdf')) order_id = order_id.replace(/\.pdf$/, '');
    if (!/^[a-zA-Z0-9-_]+$/.test(order_id)) return res.status(400).json({ message: 'Invalid order_id format' });

    let bookingQuery = await pool.query(
      'SELECT products, total, customer_name, address, mobile_number, email, district, state, customer_type, pdf FROM public.dbooking WHERE order_id = $1',
      [order_id]
    );

    if (bookingQuery.rows.length === 0) {
      const parts = order_id.split('-');
      if (parts.length > 1) {
        const possibleOrderId = parts.slice(1).join('-');
        bookingQuery = await pool.query(
          'SELECT products, total, customer_name, address, mobile_number, email, district, state, customer_type, pdf FROM public.dbooking WHERE order_id = $1',
          [possibleOrderId]
        );
      }
    }

    if (bookingQuery.rows.length === 0) return res.status(404).json({ message: `Invoice not found for order_id '${order_id}'` });

    const { products, total, customer_name, address, mobile_number, email, district, state, customer_type, pdf } = bookingQuery.rows[0];

    if (!fs.existsSync(pdf)) {
      const regeneratedPdfPath = await generateInvoicePDF(
        { order_id: bookingQuery.rows[0].order_id, customer_type, total },
        { customer_name, address, mobile_number, email, district, state },
        JSON.parse(products)
      );
      await pool.query('UPDATE public.dbooking SET pdf = $1 WHERE order_id = $2', [regeneratedPdfPath, bookingQuery.rows[0].order_id]);
    }

    const safeCustomerName = customer_name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${safeCustomerName}-${bookingQuery.rows[0].order_id}.pdf`);
    fs.createReadStream(pdf).pipe(res);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch invoice', error: err.message });
  }
};

exports.getProducts = async (req, res) => {
  try {
    const query = 'SELECT id, serial_number, productname, price, per, discount, stock, image, status FROM public.gift_box_dealers WHERE status = \'on\' AND stock > 0';
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
      status: row.status
    }));
    res.status(200).json(products);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch products' });
  }
};

exports.bookProduct = async (req, res) => {
  try {
    const { tableName, id } = req.params;
    const { quantity } = req.body;

    if (tableName !== 'gift_box_dealers') return res.status(400).json({ message: 'Booking is only available for gift_box_dealers' });
    if (!quantity || quantity <= 0) return res.status(400).json({ message: 'Valid quantity is required' });

    const product = await pool.query('SELECT stock FROM public.gift_box_dealers WHERE id = $1', [id]);
    if (product.rows.length === 0) return res.status(404).json({ message: 'Product not found' });
    if (quantity > product.rows[0].stock) return res.status(400).json({ message: 'Insufficient stock' });

    const newStock = product.rows[0].stock - quantity;
    await pool.query('UPDATE public.gift_box_dealers SET stock = $1 WHERE id = $2', [newStock, id]);

    res.status(200).json({ message: 'Product booked successfully', newStock });
  } catch (err) {
    res.status(500).json({ message: 'Failed to book product' });
  }
};