const express = require('express');
const router = express.Router();
const DBookingController = require('../Controller/Dbooking.controller');

router.get('/admins', DBookingController.getAdmins);
router.get('/admins/:adminId/transactions', DBookingController.getAdminTransactions);
router.get('/tracking/bookings', DBookingController.getBookings);
router.patch('/tracking/bookings/:id/status', DBookingController.updateBookingStatus);
router.post('/dbooking', DBookingController.createBooking);
router.get('/dbooking/invoice/:order_id', DBookingController.getInvoice);
router.get('/product', DBookingController.getProducts);
router.patch('/product/:tableName/:id/book', DBookingController.bookProduct);
router.get('/transactions/:bookingId', DBookingController.getTransactions)

module.exports = router;