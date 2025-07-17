const { Pool } = require('pg');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
});

const generateQuotationPDF = (quotationData, customerDetails, products) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const safeCustomerName = customerDetails.customer_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const pdfPath = path.join(__dirname, '../quotation', `${safeCustomerName}-${quotationData.est_id}.pdf`);
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    doc.fontSize(20).font('Helvetica-Bold').text('Quotation', 50, 50, { align: 'center' });
    doc.fontSize(12).font('Helvetica')
      .text('Phoenix Crackers', 50, 80)
      .text('Anil Kumar Eye Hospital Opp, Sattur Road, Sivakasi', 50, 95)
      .text('Mobile: +91 63836 59214', 50, 110)
      .text('Email: nivasramasamy27@gmail.com', 50, 125)
      .text(`Customer: ${customerDetails.customer_name || 'N/A'}`, 300, 80, { align: 'right' })
      .text(`Contact: ${customerDetails.mobile_number || 'N/A'}`, 300, 95, { align: 'right' })
      .text(`Address: ${customerDetails.address || 'N/A'}`, 300, 110, { align: 'right' })
      .text(`District: ${customerDetails.district || 'N/A'}`, 300, 140, { align: 'right' })
      .text(`State: ${customerDetails.state || 'N/A'}`, 300, 150, { align: 'right' })
      .text(`Customer Type: ${quotationData.customer_type || 'User'}`, 300, 160, { align: 'right' })
      .text(`Quotation ID: ${quotationData.est_id}`, 300, 170, { align: 'right' });

    const tableY = 220;
    doc.fontSize(10).font('Helvetica-Bold')
      .text('Product', 50, tableY)
      .text('Quantity', 250, tableY)
      .text('Price', 350, tableY)
      .text('Total', 450, tableY);

    let y = tableY + 25;
    let calculatedTotal = 0;
    products.forEach((product, index) => {
      const price = parseFloat(product.price);
      const discount = parseFloat(product.discount);
      const productTotal = (price - (price * discount / 100)) * product.quantity;
      calculatedTotal += productTotal;
      doc.font('Helvetica')
        .text(product.productname, 50, y)
        .text(product.quantity, 250, y)
        .text(`Rs.${price.toFixed(2)}`, 350, y)
        .text(`Rs.${productTotal.toFixed(2)}`, 450, y);
      y += 20;
      if (index < products.length - 1) doc.moveTo(50, y - 5).lineTo(550, y - 5).stroke();
    });

    doc.moveDown(2);
    doc.font('Helvetica-Bold').text(`Total: Rs.${calculatedTotal.toFixed(2)}`, 450, y + 20);

    doc.end();
    stream.on('finish', () => resolve({ pdfPath, calculatedTotal }));
    stream.on('error', (err) => reject(err));
  });
};

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
      .text(`Contact: ${customerDetails.mobile_number || 'N/A'}`, 50, 195)
      .text(`Address: ${customerDetails.address || 'N/A'}`, 50, 210)
      .text(`District: ${customerDetails.district || 'N/A'}`, 50, 225)
      .text(`State: ${customerDetails.state || 'N/A'}`, 50, 240)
      .text(`Customer Type: ${bookingData.customer_type || 'User'}`, 50, 255)
      .text(`Order ID: ${bookingData.order_id}`, 50, 270);

    const tableY = 320;
    doc.fontSize(10).font('Helvetica-Bold')
      .text('Product', 50, tableY)
      .text('Quantity', 250, tableY)
      .text('Price', 350, tableY)
      .text('Total', 450, tableY);
    
    let y = tableY + 25;
    let total = 0;
    products.forEach((product, index) => {
      const price = parseFloat(product.price);
      const discount = parseFloat(product.discount);
      const productTotal = (price - (price * discount / 100)) * product.quantity;
      total += productTotal;
      doc.font('Helvetica')
        .text(product.productname, 50, y)
        .text(product.quantity, 250, y)
        .text(`Rs.${price.toFixed(2)}`, 350, y)
        .text(`Rs.${productTotal.toFixed(2)}`, 450, y);
      y += 20;
      if (index < products.length - 1) {
        doc.moveTo(50, y - 5).lineTo(550, y - 5).stroke();
      }
    });

    doc.moveDown(2);
    doc.font('Helvetica-Bold').text(`Total: Rs.${total.toFixed(2)}`, 450, y + 20);

    doc.end();
    
    stream.on('finish', () => {
      resolve(pdfPath);
    });
    stream.on('error', (err) => {
      reject(err);
    });
  });
};

exports.createQuotation = async (req, res) => {
  try {
    const { customer_id, products, total, customer_type, customer_name, address, mobile_number, email, district, state } = req.body;

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: 'Products array is required and must not be empty' });
    }
    if (!total || total <= 0) return res.status(400).json({ message: 'Total must be a positive number' });

    let finalCustomerType = customer_type || 'User';
    let customerDetails = { customer_name, address, mobile_number, email, district, state };

    if (customer_id) {
      const customerCheck = await pool.query(
        'SELECT id, customer_name, address, mobile_number, email, district, state, customer_type FROM public.gbcustomers WHERE id = $1',
        [customer_id]
      );
      if (customerCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Customer not found' });
      }
      const { customer_name: db_name, address: db_address, mobile_number: db_mobile, email: db_email, district: db_district, state: db_state, customer_type: dbCustomerType } = customerCheck.rows[0];
      finalCustomerType = customer_type || dbCustomerType || 'User';
      customerDetails = { customer_name: db_name, address: db_address, mobile_number: db_mobile, email: db_email, district: db_district, state: db_state };
    } else {
      if (finalCustomerType !== 'User') {
        return res.status(400).json({ message: 'Customer type must be "User" for quotations without customer ID' });
      }
      if (!customer_name) return res.status(400).json({ message: 'Customer name is required' });
      if (!address) return res.status(400).json({ message: 'Address is required' });
      if (!district) return res.status(400).json({ message: 'District is required' });
      if (!state) return res.status(400).json({ message: 'State is required' });
      if (!mobile_number) return res.status(400).json({ message: 'Mobile number is required' });
      if (!email) return res.status(400).json({ message: 'Email is required' });
    }

    for (const product of products) {
      const { id, product_type, quantity } = product;
      if (!id || !product_type || !quantity || quantity < 1) {
        return res.status(400).json({ message: 'Each product must have a valid ID, product type, and positive quantity' });
      }
      const tableName = product_type.toLowerCase().replace(/\s+/g, '_');
      const productCheck = await pool.query(
        `SELECT id FROM public.${tableName} WHERE id = $1 AND status = 'on'`,
        [id]
      );
      if (productCheck.rows.length === 0) {
        return res.status(404).json({ message: `Product ${id} of type ${product_type} not found or not available` });
      }
    }

    const est_id = `EST-${Date.now()}`;
    const { pdfPath, pdfKey, calculatedTotal } = await generateQuotationPDF(
      { est_id, customer_type: finalCustomerType, total },
      customerDetails,
      products
    );

    const query = `
      INSERT INTO public.quotations (customer_id, est_id, products, total, address, mobile_number, customer_name, email, district, state, customer_type, status, created_at, pdf)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13)
      RETURNING id, created_at, customer_type, pdf, est_id
    `;
    const values = [
      customer_id || null,
      est_id,
      JSON.stringify(products),
      calculatedTotal,
      customerDetails.address || null,
      customerDetails.mobile_number || null,
      customerDetails.customer_name || null,
      customerDetails.email || null,
      customerDetails.district || null,
      customerDetails.state || null,
      finalCustomerType,
      'pending',
      pdfKey // Store S3 key
    ];
    const result = await pool.query(query, values);

    res.status(201).json({
      message: 'Quotation created successfully',
      id: result.rows[0].id,
      created_at: result.rows[0].created_at,
      customer_type: result.rows[0].customer_type,
      pdf_url: pdfPath, // Return presigned URL
      est_id: result.rows[0].est_id
    });
  } catch (err) {
    console.error('Error in createQuotation:', err);
    res.status(500).json({ message: 'Failed to create quotation', error: err.message });
  }
};

exports.getQuotations = async (req, res) => {
  try {
    const query = `
      SELECT *
      FROM public.quotations
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query);
    res.status(200).json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch quotations', error: err.message });
  }
};

exports.getQuotation = async (req, res) => {
  try {
    let { est_id } = req.params;

    if (est_id.endsWith('.pdf')) {
      est_id = est_id.replace(/\.pdf$/, '');
    }

    if (!est_id.startsWith('EST') || !/^[a-zA-Z0-9-_]+$/.test(est_id.slice(4))) {
      return res.status(400).json({ 
        message: 'Invalid est_id format', 
        details: 'Quotation ID must start with "EST" followed by alphanumeric characters, hyphens, or underscores' 
      });
    }

    let quotationQuery = await pool.query(
      'SELECT products, COALESCE(total, 0) AS total, customer_name, address, mobile_number, email, district, state, customer_type, pdf, est_id FROM public.quotations WHERE est_id = $1',
      [est_id]
    );

    if (quotationQuery.rows.length === 0) {
      const parts = est_id.split('-');
      if (parts.length > 1 && parts[0] === 'EST') {
        const possibleEstId = parts.slice(1).join('-');
        quotationQuery = await pool.query(
          'SELECT products, COALESCE(total, 0) AS total, customer_name, address, mobile_number, email, district, state, customer_type, pdf, est_id FROM public.quotations WHERE est_id = $1',
          [`EST-${possibleEstId}`]
        );
      }
    }

    if (quotationQuery.rows.length === 0) {
      return res.status(404).json({ 
        message: 'Quotation not found', 
        details: `No quotation found for est_id '${est_id}'. Please use an est_id starting with 'EST' (e.g., 'EST-1751548161837').`
      });
    }

    const { products, total, customer_name, address, mobile_number, email, district, state, customer_type, pdf, est_id: foundEstId } = quotationQuery.rows[0];

    if (!fs.existsSync(pdf)) {
      const regeneratedPdfPath = await generateQuotationPDF(
        { est_id: foundEstId, customer_type, total },
        { customer_name, address, mobile_number, email, district, state },
        JSON.parse(products)
      );
      await pool.query('UPDATE public.quotations SET pdf = $1 WHERE est_id = $2', [regeneratedPdfPath.pdfPath, foundEstId]);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=${customer_name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}-${foundEstId}.pdf`);
    fs.createReadStream(pdf).pipe(res);
  } catch (err) {
    res.status(500).json({ message: 'Failed to fetch quotation', error: err.message });
  }
};

exports.bookQuotation = async (req, res) => {
  try {
    const { est_id, customer_id, products, total, customer_type, customer_name, address, mobile_number, email, district, state } = req.body;

    if (!est_id || !est_id.startsWith('EST') || !/^[a-zA-Z0-9-_]+$/.test(est_id.slice(4))) {
      return res.status(400).json({ message: 'Valid est_id starting with "EST" is required' });
    }

    const quotationQuery = await pool.query(
      'SELECT customer_id, products, total, customer_name, address, mobile_number, email, district, state, customer_type, status FROM public.quotations WHERE est_id = $1',
      [est_id]
    );

    if (quotationQuery.rows.length === 0) {
      return res.status(404).json({ message: 'Quotation not found' });
    }

    if (quotationQuery.rows[0].status !== 'pending') {
      return res.status(400).json({ message: 'Quotation is not in pending status' });
    }

    const {
      customer_id: db_customer_id,
      products: db_products,
      total: db_total,
      customer_name: db_customer_name,
      address: db_address,
      mobile_number: db_mobile_number,
      email: db_email,
      district: db_district,
      state: db_state,
      customer_type: db_customer_type
    } = quotationQuery.rows[0];

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: 'Products array is required and must not be empty' });
    }
    if (!total || total <= 0) return res.status(400).json({ message: 'Total must be a positive number' });

    let finalCustomerType = customer_type || db_customer_type || 'User';
    let customerDetails = {
      customer_name: customer_name || db_customer_name,
      address: address || db_address,
      mobile_number: mobile_number || db_mobile_number,
      email: email || db_email,
      district: district || db_district,
      state: state || db_state
    };

    let finalCustomerId = customer_id || db_customer_id;

    if (finalCustomerId) {
      const customerCheck = await pool.query(
        'SELECT id, customer_name, address, mobile_number, email, district, state, customer_type FROM public.gbcustomers WHERE id = $1',
        [finalCustomerId]
      );
      if (customerCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Customer not found' });
      }
      const { customer_name, address, mobile_number, email, district, state, customer_type } = customerCheck.rows[0];
      finalCustomerType = customer_type || finalCustomerType;
      customerDetails = { customer_name, address, mobile_number, email, district, state };
    } else {
      if (finalCustomerType !== 'User') {
        return res.status(400).json({ message: 'Customer type must be "User" for bookings without customer ID' });
      }
      if (!customerDetails.customer_name) return res.status(400).json({ message: 'Customer name is required' });
      if (!customerDetails.address) return res.status(400).json({ message: 'Address is required' });
      if (!customerDetails.district) return res.status(400).json({ message: 'District is required' });
      if (!customerDetails.state) return res.status(400).json({ message: 'State is required' });
      if (!customerDetails.mobile_number) return res.status(400).json({ message: 'Mobile number is required' });
      if (!customerDetails.email) return res.status(400).json({ message: 'Email is required' });
    }

    for (const product of products) {
      const { id, product_type, quantity } = product;
      if (!id || !product_type || !quantity || quantity < 1) {
        return res.status(400).json({ message: 'Each product must have a valid ID, product type, and positive quantity' });
      }
      const tableName = product_type.toLowerCase().replace(/\s+/g, '_');
      const productCheck = await pool.query(
        `SELECT id FROM public.${tableName} WHERE id = $1 AND status = 'on'`,
        [id]
      );
      if (productCheck.rows.length === 0) {
        return res.status(404).json({ message: `Product ${id} of type ${product_type} not found or not available` });
      }
    }

    const order_id = est_id.replace(/^EST/, 'DORD');
    if (!order_id.startsWith('DORD') || !/^[a-zA-Z0-9-_]+$/.test(order_id.slice(4))) {
      return res.status(400).json({ message: 'Order ID must start with "DORD" followed by alphanumeric characters, hyphens, or underscores' });
    }

    const pdfPath = await generateInvoicePDF(
      { order_id, customer_type: finalCustomerType, total },
      customerDetails,
      products
    );

    const query = `
      INSERT INTO public.dbooking (customer_id, order_id, products, total, address, mobile_number, customer_name, email, district, state, customer_type, status, created_at, pdf)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13)
      RETURNING id, created_at, customer_type, pdf, order_id
    `;
    const values = [
      finalCustomerId || null,
      order_id,
      JSON.stringify(products),
      parseFloat(total),
      customerDetails.address || null,
      customerDetails.mobile_number || null,
      customerDetails.customer_name || null,
      customerDetails.email || null,
      customerDetails.district || null,
      customerDetails.state || null,
      finalCustomerType,
      'booked',
      pdfPath
    ];
    const result = await pool.query(query, values);

    await pool.query('UPDATE public.quotations SET status = $1 WHERE est_id = $2', ['booked', est_id]);

    try {
      const mediaId = await uploadPDF(pdfPath);
      await sendTemplateWithPDF(mediaId, total, customerDetails);
    } catch (err) {
      console.error('WhatsApp PDF sending failed:', err);
    }

    res.status(201).json({
      message: 'Booking created successfully',
      id: result.rows[0].id,
      created_at: result.rows[0].created_at,
      customer_type: result.rows[0].customer_type,
      pdf_path: result.rows[0].pdf,
      order_id: result.rows[0].order_id
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to create booking', error: err.message });
  }
};

exports.cancelQuotation = async (req, res) => {
  try {
    const { est_id } = req.params;

    const quotationQuery = await pool.query(
      'SELECT id FROM public.quotations WHERE est_id = $1 AND status = $2',
      [est_id, 'pending']
    );

    if (quotationQuery.rows.length === 0) {
      return res.status(404).json({ message: 'Quotation not found or already processed' });
    }

    await pool.query('UPDATE public.quotations SET status = $1 WHERE est_id = $2', ['canceled', est_id]);

    res.status(200).json({ message: 'Quotation canceled successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to cancel quotation', error: err.message });
  }
};