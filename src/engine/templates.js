// Bot factory + starter templates.

const uid = () => Math.random().toString(36).slice(2, 10).toUpperCase();

export const DEFAULT_CODE_HOOK = `// Fulfillment Lambda (Node.js-style). Runs in an isolated worker.
// Receives a Lex V2 event and must return a Lex V2 response.
exports.handler = async (event) => {
  const intent = event.sessionState.intent;
  const slot = (n) => intent.slots[n]?.value?.interpretedValue;
  console.log('Fulfilling', intent.name);

  return {
    sessionState: {
      dialogAction: { type: 'Close' },
      intent: { name: intent.name, state: 'Fulfilled' },
      sessionAttributes: event.sessionState.sessionAttributes,
    },
    messages: [{ contentType: 'PlainText', content: 'Done! Your request for ' + intent.name + ' is complete.' }],
  };
};
`;

export function makeIntent(p = {}) {
  return {
    id: uid(),
    name: 'NewIntent',
    description: '',
    utterances: [],
    slots: [],
    confirmationPrompt: '',
    declinationResponse: "Okay, I won't do that.",
    closingResponse: '',
    fulfillmentEnabled: false,
    ...p,
    slots: (p.slots || []).map((s) => ({ required: true, retryPrompt: '', ...s })),
  };
}

export function makeBot(p = {}) {
  const now = new Date().toISOString();
  return {
    id: uid(),
    name: 'MyBot',
    description: '',
    locale: 'en_US',
    voice: '',
    idleSessionTTL: 300,
    nluThreshold: 0.4,
    fallbackMessage: "Sorry, I didn't understand that. Could you rephrase?",
    welcome: '',
    codeHook: DEFAULT_CODE_HOOK,
    slotTypes: [],
    versions: [],
    aliases: [{ name: 'TestBotAlias', version: 'DRAFT' }],
    createdAt: now,
    updatedAt: now,
    ...p,
    intents: (p.intents || []).map(makeIntent),
  };
}

const PIZZA_HOOK = `// PizzaBot fulfillment Lambda — prices the order and issues an order id.
exports.handler = async (event) => {
  const intent = event.sessionState.intent;
  const slot = (n) => intent.slots[n]?.value?.interpretedValue;
  const attrs = event.sessionState.sessionAttributes || {};
  console.log('Fulfilling', intent.name, JSON.stringify(intent.slots));

  if (intent.name === 'OrderPizza') {
    const prices = { Small: 199, Medium: 349, Large: 499 };
    const qty = Number(slot('Quantity') || 1);
    const total = (prices[slot('Size')] || 349) * qty;
    const orderId = 'PZ' + Math.floor(1000 + Math.random() * 9000);
    attrs.lastOrderId = orderId;
    console.log('Created order', orderId, 'total', total);
    return close(intent, attrs,
      'Order ' + orderId + ' placed! ' + qty + ' ' + slot('Size') + ' ' + slot('PizzaType') +
      (qty > 1 ? ' pizzas' : ' pizza') + ', total ' + total + ' rupees, arriving at ' + slot('DeliveryTime') + '.');
  }

  if (intent.name === 'CheckOrderStatus') {
    const id = slot('OrderId');
    const stages = ['being prepared', 'in the oven', 'out for delivery'];
    return close(intent, attrs, 'Order ' + id + ' is ' + stages[id.length % 3] + '.');
  }

  return close(intent, attrs, 'Done!');
};

function close(intent, attrs, text) {
  return {
    sessionState: {
      dialogAction: { type: 'Close' },
      intent: { name: intent.name, state: 'Fulfilled' },
      sessionAttributes: attrs,
    },
    messages: [{ contentType: 'PlainText', content: text }],
  };
}
`;

export const TEMPLATES = {
  PizzaBot: () => makeBot({
    name: 'PizzaBot',
    description: 'Takes pizza orders and tracks deliveries for a pizzeria',
    welcome: "Hi! I'm PizzaBot. You can order a pizza or track an order.",
    codeHook: PIZZA_HOOK,
    slotTypes: [
      { name: 'PizzaType', description: 'Menu items', resolution: 'restrict', values: [
        { value: 'Margherita', synonyms: ['cheese', 'plain cheese', 'classic'] },
        { value: 'Pepperoni', synonyms: ['peperoni', 'salami'] },
        { value: 'Veggie Supreme', synonyms: ['veggie', 'vegetarian', 'veg'] },
        { value: 'Paneer Tikka', synonyms: ['paneer'] },
        { value: 'BBQ Chicken', synonyms: ['chicken', 'barbecue chicken', 'barbecue'] },
      ] },
      { name: 'PizzaSize', description: 'Pizza sizes', resolution: 'restrict', values: [
        { value: 'Small', synonyms: ['personal', 'regular', 'tiny'] },
        { value: 'Medium', synonyms: ['mid', 'normal'] },
        { value: 'Large', synonyms: ['big', 'family', 'huge', 'extra large'] },
      ] },
    ],
    intents: [
      {
        name: 'OrderPizza',
        description: 'Order one or more pizzas for delivery',
        utterances: [
          'I want to order a pizza',
          'I would like a pizza',
          'order a {Size} {PizzaType} pizza',
          'get me a {PizzaType} pizza',
          'can I get {Quantity} {PizzaType} pizzas',
          'order pizza',
        ],
        slots: [
          { name: 'PizzaType', type: 'PizzaType', prompt: 'Which pizza would you like? We have Margherita, Pepperoni, Veggie Supreme, Paneer Tikka and BBQ Chicken.' },
          { name: 'Size', type: 'PizzaSize', prompt: 'What size — small, medium or large?' },
          { name: 'Quantity', type: 'AMAZON.Number', prompt: 'How many pizzas?' },
          { name: 'DeliveryTime', type: 'AMAZON.Time', prompt: 'What time should we deliver?' },
        ],
        confirmationPrompt: 'So that is {Quantity} {Size} {PizzaType}, delivered at {DeliveryTime}. Shall I place the order?',
        declinationResponse: "No problem, I've cancelled that order.",
        closingResponse: 'Your order is placed!',
        fulfillmentEnabled: true,
      },
      {
        name: 'CheckOrderStatus',
        description: 'Track the status of an existing order using its order id',
        utterances: ['where is my order', 'track my order', 'track order {OrderId}', 'what is the status of order {OrderId}', 'is my pizza on the way'],
        slots: [{ name: 'OrderId', type: 'AMAZON.AlphaNumeric', prompt: 'What is your order id? It looks like PZ1234.' }],
        fulfillmentEnabled: true,
      },
      {
        name: 'Greeting',
        description: 'User says hello or asks what the bot can do',
        utterances: ['hi', 'hello', 'hey there', 'what can you do', 'help'],
        closingResponse: "Hi! I'm PizzaBot. I can take a pizza order or track an existing one.",
      },
    ],
  }),

  HotelBookingBot: () => makeBot({
    name: 'HotelBookingBot',
    description: 'Books hotel rooms and cancels reservations',
    welcome: 'Welcome! I can book a hotel room or cancel a booking.',
    slotTypes: [
      { name: 'RoomType', description: 'Room categories', resolution: 'restrict', values: [
        { value: 'Standard', synonyms: ['basic', 'normal', 'single'] },
        { value: 'Deluxe', synonyms: ['premium', 'double'] },
        { value: 'Suite', synonyms: ['luxury', 'presidential'] },
      ] },
    ],
    intents: [
      {
        name: 'BookHotel',
        description: 'Reserve a hotel room in a city',
        utterances: ['book a hotel', 'I need a room', 'book a hotel in {City}', 'reserve a {RoomType} room', 'I need a room for {Nights} nights', 'book a hotel in {City} on {CheckInDate}'],
        slots: [
          { name: 'City', type: 'AMAZON.City', prompt: 'Which city are you staying in?' },
          { name: 'CheckInDate', type: 'AMAZON.Date', prompt: 'What day do you check in?' },
          { name: 'Nights', type: 'AMAZON.Number', prompt: 'How many nights?' },
          { name: 'RoomType', type: 'RoomType', prompt: 'Standard, deluxe or suite?' },
        ],
        confirmationPrompt: 'A {RoomType} room in {City} from {CheckInDate} for {Nights} nights. Should I book it?',
        declinationResponse: 'Okay, I have not booked anything.',
        closingResponse: 'Booked! Your {RoomType} room in {City} is confirmed for {CheckInDate}.',
      },
      {
        name: 'CancelBooking',
        description: 'Cancel an existing hotel reservation by booking reference',
        utterances: ['cancel my booking', 'cancel reservation {BookingRef}', 'I want to cancel my hotel'],
        slots: [{ name: 'BookingRef', type: 'AMAZON.AlphaNumeric', prompt: 'What is your booking reference?' }],
        confirmationPrompt: 'Cancel booking {BookingRef}?',
        closingResponse: 'Booking {BookingRef} has been cancelled.',
      },
    ],
  }),
};
