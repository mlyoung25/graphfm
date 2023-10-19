const axios = require('axios');
const validator = require('validator');
const nodemailer = require('nodemailer');
const { LastFmNode } = require('lastfm');

/**
 * GET /contact
 * Contact form page.
 */
exports.getContact = async (req, res, next) => {
  const { username } = req.query;
  const lastfm = new LastFmNode({
    api_key: process.env.LASTFM_KEY,
    secret: process.env.LASTFM_SECRET
  });
  const getUserTop = (username) =>
    new Promise((resolve, reject) => {
      lastfm.request('user.getTopArtists', {
        user: username,
        handlers: {
          success: resolve,
          error: reject
        }
      });
    });
  const getArtistImage = (artistName, username) =>
    new Promise((resolve, reject) => {
      lastfm.request('artist.getInfo', {
        artist: artistName,
        user: username,
        handlers: {
          success: (data) => {
            resolve(data.artist.image[3]['#text']); // Retrieves large size image URL
          },
          error: reject
        }
      });
    });
  try {
    const { topartists } = await getUserTop(username);
    const playcounts = topartists.artist.map((artist) => parseInt(artist.playcount, 10));
    const minPlaycount = Math.min(...playcounts);
    const maxPlaycount = Math.max(...playcounts);
    const maxBubbleSize = (minPlaycount / maxPlaycount) > 0.125 ? 125 : 250;
    const topArtists = await Promise.all(topartists.artist.slice(0, 50).map(async (artist) => {
      const playcountRatio = parseInt(artist.playcount, 10) / maxPlaycount;
      const scaledRadius = (playcountRatio ** (1 / 1.2)) * maxBubbleSize;
      return {
        x: 0,
        y: 0,
        radius: scaledRadius,
        imageUrl: await getArtistImage(artist.name, username),
        name: artist.name,
        ...artist,
      };
    }));
    const user = {
      name: topartists['@attr'].user,
      topArtists
    };
    res.render('contact', {
      title: 'Last.fm API',
      user,
    });
  } catch (err) {
    console.log('See error codes at: https://www.last.fm/api/errorcodes');
    console.log(err);
    next(err);
  }
};

/**
 * POST /contact
 * Send a contact form via Nodemailer.
 */
exports.postContact = async (req, res) => {
  const validationErrors = [];
  let fromName;
  let fromEmail;
  if (!req.user) {
    if (validator.isEmpty(req.body.name)) validationErrors.push({ msg: 'Please enter your name' });
    if (!validator.isEmail(req.body.email)) validationErrors.push({ msg: 'Please enter a valid email address.' });
  }
  if (validator.isEmpty(req.body.message)) validationErrors.push({ msg: 'Please enter your message.' });

  function getValidateReCAPTCHA(token) {
    return axios.post(`https://www.google.com/recaptcha/api/siteverify?secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${token}`,
      {},
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      });
  }

  try {
    const validateReCAPTCHA = await getValidateReCAPTCHA(req.body['g-recaptcha-response']);
    if (!validateReCAPTCHA.data.success) {
      validationErrors.push({ msg: 'reCAPTCHA validation failed.' });
    }

    if (validationErrors.length) {
      req.flash('errors', validationErrors);
      return res.redirect('/contact');
    }

    if (!req.user) {
      fromName = req.body.name;
      fromEmail = req.body.email;
    } else {
      fromName = req.user.profile.name || '';
      fromEmail = req.user.email;
    }

    const transportConfig = {
      host: process.env.SMTP_HOST,
      port: 465,
      secure: true,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      }
    };

    let transporter = nodemailer.createTransport(transportConfig);

    const mailOptions = {
      to: process.env.SITE_CONTACT_EMAIL,
      from: `${fromName} <${fromEmail}>`,
      subject: 'Contact Form | Hackathon Starter',
      text: req.body.message
    };

    return transporter.sendMail(mailOptions)
      .then(() => {
        req.flash('success', { msg: 'Email has been sent successfully!' });
        res.redirect('/contact');
      })
      .catch((err) => {
        if (err.message === 'self signed certificate in certificate chain') {
          console.log('WARNING: Self signed certificate in certificate chain. Retrying with the self signed certificate. Use a valid certificate if in production.');
          transportConfig.tls = transportConfig.tls || {};
          transportConfig.tls.rejectUnauthorized = false;
          transporter = nodemailer.createTransport(transportConfig);
          return transporter.sendMail(mailOptions);
        }
        console.log('ERROR: Could not send contact email after security downgrade.\n', err);
        req.flash('errors', { msg: 'Error sending the message. Please try again shortly.' });
        return false;
      })
      .then((result) => {
        if (result) {
          req.flash('success', { msg: 'Email has been sent successfully!' });
          return res.redirect('/contact');
        }
      })
      .catch((err) => {
        console.log('ERROR: Could not send contact email.\n', err);
        req.flash('errors', { msg: 'Error sending the message. Please try again shortly.' });
        return res.redirect('/contact');
      });
  } catch (err) {
    console.log(err);
  }
};
