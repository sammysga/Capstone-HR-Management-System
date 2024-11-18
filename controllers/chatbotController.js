const supabase = require('../public/config/supabaseClient');
const bcrypt = require('bcrypt');
const { getJobDetails } = require('./applicantController');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Setup Multer for file uploads
const upload = multer({
    dest: path.join(__dirname, '../uploads'), // Temporary folder to store uploaded files
    limits: { fileSize: 5 * 1024 * 1024 }, // Limit file size to 5MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['application/pdf'];
        if (!allowedTypes.includes(file.mimetype)) {
            return cb(new Error('Only PDF files are allowed.'));
        }
        cb(null, true);
    },
});

const chatbotController = {

      // New function to handle file uploads
      handleFileUpload: async function(req, res) {
        try {
            const file = req.file;

            if (!file) {
                return res.status(400).json({ message: 'No file uploaded.' });
            }

            // Move the file to a permanent location (e.g., user-specific folder)
            const userFolder = path.join(__dirname, '../uploads', req.session.userId || 'guest');
            if (!fs.existsSync(userFolder)) {
                fs.mkdirSync(userFolder, { recursive: true });
            }

            const newFilePath = path.join(userFolder, file.originalname);
            fs.renameSync(file.path, newFilePath);

            console.log(`File uploaded successfully: ${newFilePath}`);
            res.json({ message: 'File uploaded successfully.' });
        } catch (error) {
            console.error('Error handling file upload:', error);
            res.status(500).json({ message: 'Error uploading file.' });
        }
    },

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
    
     // Updated chatbot message handler to handle file upload prompts
    handleChatbotMessage: async function(req, res) {
        try {
            const userMessage = req.body.message.toLowerCase();
            console.log('User message received:', userMessage);
            let botResponse;
            const positions = await chatbotController.getJobPositionsList();
            const selectedPosition = positions.find(position => userMessage.includes(position.toLowerCase()));

            if (selectedPosition) {
                req.session.selectedPosition = selectedPosition;
                const jobDetails = await chatbotController.getJobDetails(selectedPosition);

                if (jobDetails) {
                    const jobInfo = `You have chosen *${selectedPosition}*. Here are the details of the chosen job:\n` +
                        `Job Title: ${jobDetails.jobTitle}\n` +
                        `Job Description: ${jobDetails.jobDescrpt}\n` +
                        `Would you like to proceed with your application?\n- Yes\n- No`;

                    botResponse = jobInfo;
                } else {
                    botResponse = "Sorry, I couldn't find the job details.";
                }
            } else if (userMessage.includes('yes')) {
                const jobId = (await chatbotController.getJobDetails(req.session.selectedPosition)).jobId;
                const questions = await chatbotController.getScreeningQuestions(jobId);

                req.session.screeningQuestions = questions;
                req.session.currentQuestionIndex = 0;

                if (questions.length) {
                    botResponse = `Great! Now it’s time to check if you are the right applicant for this position! Please rate the following questions based on how they apply to you: 5 - applies 100% to you, 1 - not at all:\n` +
                        `1. ${questions[0]}`;
                } else {
                    botResponse = "No screening questions available for this position.";
                }
            } else if (userMessage.includes('no')) {
                botResponse = 'No problem! Here are our current job openings:\n' + positions.map(pos => `- ${pos}`).join('\n') + '\nPlease select a position.';
            } else if (req.session.screeningQuestions) {
                const questions = req.session.screeningQuestions;
                const currentIndex = req.session.currentQuestionIndex;

                if (currentIndex < questions.length - 1) {
                    botResponse = `Thank you for your answer! Here’s the next question:\n${currentIndex + 2}. ${questions[currentIndex + 1]}`;
                    req.session.currentQuestionIndex++;
                } else {
                    botResponse = "You have completed the screening questions. Please upload your certifications and resume as PDF files. Type 'done' when finished.";
                    delete req.session.screeningQuestions;
                    delete req.session.currentQuestionIndex;
                }
            } else if (userMessage === 'done') {
                botResponse = "Thank you! Your application is complete. We will review your submissions and get back to you.";
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
    
    // Function to get screening questions
    getScreeningQuestions: async function(jobId) {
        const degreesQuery = await supabase
            .from('jobreqdegrees')
            .select('jobReqDegreeDescrpt')
            .eq('jobId', jobId);
    
        const experiencesQuery = await supabase
            .from('jobreqexperiences')
            .select('jobReqExperienceDescrpt')
            .eq('jobId', jobId);
    
        const skillsQuery = await supabase
            .from('jobreqskills')
            .select('jobReqSkillName')
            .eq('jobId', jobId);
    
        const questions = [
            ...degreesQuery.data.map(d => `Degree required: ${d.jobReqDegreeDescrpt}`),
            ...experiencesQuery.data.map(e => `Experience required: ${e.jobReqExperienceDescrpt}`),
            ...skillsQuery.data.map(s => `Skill required: ${s.jobReqSkillName}`)
        ];
    
        return questions;
    },
    
    // Function to fetch job positions and format them for chatbot response
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

    // Function to fetch job details from the db
    getJobDetails: async function(jobTitle) {
        try {
            const { data: jobDetails, error } = await supabase
                .from('jobpositions')
                .select('*')
                .eq('jobTitle', jobTitle)
                .single();
    
            if (error) throw new Error('Error fetching job details: ' + error.message);
    
            return jobDetails; // Return the job details
        } catch (error) {
            console.error('Error fetching job details:', error);
            return null; 
        }
    }    
};

module.exports = {
    chatbotController,
    upload, // Export Multer configuration for file uploads
};
