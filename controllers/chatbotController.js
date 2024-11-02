const supabase = require('../public/config/supabaseClient');
const bcrypt = require('bcrypt');

const chatbotController = {

    // Function to render chatbot page with the initial greeting
    getChatbotPage: async function(req, res) {
        try {
            const initialMessage = "Hi! Welcome to Prime Infrastructure's recruitment portal. What position are you going to apply for?";
            const positions = await chatbotController.getJobPositionsList();
            console.log('Positions fetched:', positions); // log to see what positions are returned

            const initialResponse = JSON.stringify(`${initialMessage}\nHere are our current job openings:\n${positions.map(pos => `- ${pos}`).join('\n')}\nPlease select a position.`);
            console.log('Initial response:', initialResponse);

            res.render('applicant_pages/chatbot', { initialResponse, errors: {} });
        } catch (error) {
            console.error('Error rendering chatbot page:', error);
            res.status(500).send('Error loading chatbot page');
        }
    },
    
    // Function to handle incoming chatbot messages
    handleChatbotMessage: async function(req, res) {
        try {
            const userMessage = req.body.message.toLowerCase();
            console.log('User message received:', userMessage); 
            let botResponse;
            const positions = await chatbotController.getJobPositionsList();
            const selectedPosition = positions.find(position => userMessage.includes(position.toLowerCase()));

            if (selectedPosition) {
                req.session.selectedPosition = selectedPosition; 
                botResponse = "Thank you! You've selected " + selectedPosition + ". Let's proceed with the application.";
            } else {
                botResponse = 'Here are our current job openings:\n' + positions.map(pos => `- ${pos}`).join('\n') + '\nPlease select a position.';
            }

            console.log('Bot response:', botResponse); 
            res.json({ response: botResponse });
        } catch (error) {
            console.error('Error processing chatbot message:', error);
            res.status(500).json({ response: 'Sorry, I am having trouble understanding that.' });
        }
    },

    // Helper function to fetch job positions and format them for chatbot response
    getJobPositionsList: async function() {
        try {
            const { data: jobpositions, error } = await supabase
                .from('jobpositions')
                .select('jobId, jobTitle');
    
            if (error) {
                console.error('Error fetching job positions:', error);
                return []; // Return an empty array on error
            }
    
            return jobpositions.map(position => position.jobTitle);
        } catch (error) {
            console.error('Server error:', error);
            return [];
        }
    },    
};

module.exports = chatbotController;
