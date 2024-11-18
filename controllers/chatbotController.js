const supabase = require('../public/config/supabaseClient');
const bcrypt = require('bcrypt');
const expressFileUpload = require('express-fileupload');

const { getJobDetails } = require('./applicantController');
const fs = require('fs');
const path = require('path');

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
    
                if (currentIndex < questions.length) {
                    // TODO: store the user's answer
                    botResponse = `Thank you for your answer! Here’s the next question:\n${currentIndex + 2}. ${questions[currentIndex + 1]}`;
                    req.session.currentQuestionIndex++; 
                } else {
                    botResponse = "You have completed the screening questions. Please upload your certifications and resume. Type 'done' when finished.";
                    delete req.session.screeningQuestions; 
                    delete req.session.currentQuestionIndex; 
                }
            } else if (userMessage === 'done') {
                botResponse = "Thank you! Your application is complete.";
                // TODO: saving the uploaded files or any final processing
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
    },

 // Function to handle file uploads
handleFileUpload: async function(req, res) {
    try {
        // Check if the user is authenticated
        const { data: user, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return res.status(403).send('User not authenticated.');
        }

        const { file } = req.files;
        if (!file) {
            return res.status(400).send('No file uploaded.');
        }
        // Define the local file path
        const filePath = path.join(__dirname, '../uploads', file.name); // Use the uploads folder path

        // Ensure the uploads folder exists
        if (!fs.existsSync(path.join(__dirname, '../uploads'))) {
            fs.mkdirSync(path.join(__dirname, '../uploads'), { recursive: true });
        }

        // Save the file to the server locally
        await file.mv(filePath);

        // Upload file to Supabase Storage
        const { data, error } = await supabase.storage
            .from('uploads') // Your Supabase bucket name
            .upload(file.name, file.data, {
                cacheControl: '3600',  // Cache control header
                upsert: false,         // Prevent overwriting files with the same name
            });

        if (error) {
            console.error('Error uploading file to Supabase:', error);
            return res.status(500).send('Error uploading file to Supabase.');
        }

        // Generate the public URL for the uploaded file
        const fileUrl = `https://amzzxgaqoygdgkienkwf.supabase.co/storage/v1/object/public/uploads/${data.Key}`; // Replace with your actual Supabase URL
        console.log('User ID:', req.session.userId);  // Log to check the user ID
        // Insert file metadata into the database (optional)
        const { userId } = req.session; // Assuming you're storing user ID in the session or passed through request
        if (!userId) {
            console.error('User not authenticated.');
            return res.status(403).send('User not authenticated.');
        }
        
        const { data: insertedFile, error: insertError } = await supabase
            .from('user_files') // Your table for storing file metadata
            .insert([{
                userId: userId,     // User who uploaded the file
                file_name: file.name, // File name
                file_url: fileUrl,    // Public URL of the uploaded file
                uploaded_at: new Date(),
                file_size: file.size  // File size in bytes
            }]);


        if (insertError) {
            console.error('Error inserting file metadata:', insertError);
            return res.status(500).send('Error inserting file metadata into database.');
        }

        // Return a success message with the file URL
        res.send(fileUrl); // Send back the file URL instead of just a success message

    } catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).send('Error uploading file.');
    }
}

};

module.exports = chatbotController;
