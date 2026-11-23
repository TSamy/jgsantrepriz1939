/* =========================================================
   JGS Antrepriz 1939 — SITE CONFIGURATION
   This is the ONLY file to edit to publish phone/WhatsApp numbers
   or the hero poster image. Nothing else needs to change.

   PHONE NUMBERS
   - Write the full international number, starting with "+" and the
     country code. Spaces are allowed and are shown exactly as typed.
       Haiti: "+509" followed by 8 digits
       USA:   "+1" followed by 10 digits
   - Leave phone: "" (empty) to hide that contact everywhere:
     contact card, Call / WhatsApp buttons and the floating WhatsApp button.
   - An incomplete or malformed number is also hidden (never shown half-filled).
   - whatsapp: true  → show the WhatsApp button for this number.

   POSTER
   - heroPoster: path of the company-supplied still image, e.g.
     "assets/video/civelles-poster.jpg". Leave "" until the file exists.
   ========================================================= */
window.JGS_CONFIG = {
  email: 'contact@jgsantrepriz1939.com',

  whatsappMessage: 'Hello JGS Antrepriz 1939, I would like to inquire about your glass eel products.',

  contacts: [
    {
      id: 'haiti',
      label: 'Haiti Office',
      countryCode: '509',   // used to validate the number, do not change
      digits: 8,            // national digits expected after the country code
      phone: '+509 37 63 2416',
      whatsapp: true
    },
    {
      id: 'usa',
      label: 'USA Contact',
      countryCode: '1',
      digits: 10,
      phone: '+1 (954) 706-2649',
      whatsapp: true
    }
  ],

  heroPoster: 'assets/video/civelles-poster.jpg'
};
