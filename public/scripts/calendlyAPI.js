// calendlyAPI.js
const fetch = require('node-fetch');
require('dotenv').config();  // Load environment variables from .env

// Retrieve the Calendly API Key from the environment variables
const API_KEY = process.env.CALENDLY_API_KEY;

// Set up the headers for API requests
const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};

// Function to fetch events from Calendly
function getEvents() {
  const url = 'https://api.calendly.com/v1/users/me/events';

  return fetch(url, {
    method: 'GET',
    headers: headers,
  })
    .then(response => response.json())
    .then(data => {
      console.log('Upcoming Events:', data);
    })
    .catch(error => {
      console.error('Error fetching events:', error);
    });
}

// Function to create a new event
function createEvent(eventDetails) {
  const url = 'https://api.calendly.com/v1/users/me/events';

  return fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(eventDetails),
  })
    .then(response => response.json())
    .then(data => {
      console.log('Event Created:', data);
    })
    .catch(error => {
      console.error('Error creating event:', error);
    });
}

module.exports = { getEvents, createEvent };
