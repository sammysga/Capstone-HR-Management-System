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
    handleChatbotMessage: async function (req, res) {
        try {
            console.log('Start processing chatbot message'); // Log the start of the function

            const userId = req.session.user?.userId; 
            const userMessage = req.body.message.toLowerCase();
            const timestamp = new Date().toISOString(); // Current timestamp
            console.log(`User ID: ${userId}, Message: ${userMessage}, Timestamp: ${timestamp}`);

            let botResponse;
            let applicantStage = req.session.applicantStage || 'initial'; 
            console.log(`Initial Applicant Stage: ${applicantStage}`);

            const positions = await chatbotController.getJobPositionsList();
            console.log('Retrieved Positions:', positions);

            const selectedPosition = positions.find(position => userMessage.includes(position.toLowerCase()));
            console.log('Selected Position:', selectedPosition);
    
            if (selectedPosition) {
                req.session.selectedPosition = selectedPosition;
                const jobDetails = await chatbotController.getJobDetails(selectedPosition);
                console.log('Job Details:', jobDetails);
            
                if (jobDetails) {
                  
// Process certifications
const certifications = jobDetails.jobreqcertifications
    ? jobDetails.jobreqcertifications
        .map(cert => `${cert.jobReqCertificateType}: ${cert.jobReqCertificateDescrpt}`)
        .join(', ')
    : 'None';

// Process degrees
const degrees = jobDetails.jobreqdegrees
    ? jobDetails.jobreqdegrees
        .map(degree => `${degree.jobReqDegreeType}: ${degree.jobReqDegreeDescrpt}`)
        .join(', ')
    : 'None';

// Process experiences
const experiences = jobDetails.jobreqexperiences
    ? jobDetails.jobreqexperiences
        .map(exp => `${exp.jobReqExperienceType}: ${exp.jobReqExperienceDescrpt}`)
        .join(', ')
    : 'None';

// Process hard skills
const hardSkills = jobDetails.jobreqskills
    ? jobDetails.jobreqskills
        .filter(skill => skill.jobReqSkillType === 'Hard')
        .map(skill => skill.jobReqSkillName)
        .join(', ')
    : 'None';

// Process soft skills
const softSkills = jobDetails.jobreqskills
    ? jobDetails.jobreqskills
        .filter(skill => skill.jobReqSkillType === 'Soft')
        .map(skill => skill.jobReqSkillName)
        .join(', ')
    : 'None';
                    // Construct the bot response
botResponse = `You have chosen *${selectedPosition}*. Here are the details of the chosen job:\n` +
`Job Title: ${jobDetails.jobTitle}\n` +
`Job Description: ${jobDetails.jobDescrpt}\n` +
`The Job Requires the following certifications:\n${certifications}\n` +
`The Job Requires the following degrees:\n${degrees}\n` +
`The Job Requires the following experiences:\n${experiences}\n` +
`The Job Requires the following hard skills:\n${hardSkills}\n` +
`The Job Requires the following soft skills:\n${softSkills}\n` +
`Would you like to proceed with your application?\n- Yes\n- No`;
                    applicantStage = 'job_selection';
                } else {
                    botResponse = "Sorry, I couldn't find the job details.";
                }
            } 
            // Handling "Yes" response for application
            else if (userMessage.includes('yes')) {
                const jobId = (await chatbotController.getJobDetails(req.session.selectedPosition)).jobId;
                const questions = await chatbotController.getInitialScreeningQuestions(jobId);
                console.log('Initial Screening Questions:', questions);
    
                req.session.screeningQuestions = questions;
                req.session.currentQuestionIndex = 0;
                req.session.answers = []; // Initialize answers array
    
                if (questions.length) {
                    botResponse = `Great! Time to assess your suitability. Please answer:\n` +
                    `1. ${questions[0]}`;
                    applicantStage = 'screening_questions';
               } else {
                    botResponse = "No screening questions available for this position.";
                }
            } 
            // Handling "No" response for application
            else if (userMessage.includes('no')) {
                botResponse = 'No problem! Here are our current job openings:\n' + positions.map(pos => `- ${pos}`).join('\n') + '\nPlease select a position.';
                applicantStage = 'job_selection';

            // Handling screening questions
            } else if (req.session.screeningQuestions) {
                const questions = req.session.screeningQuestions;
                const currentIndex = req.session.currentQuestionIndex;

                console.log('Current Question Index:', currentIndex);
                req.session.answers.push(parseInt(userMessage)); // Store the answer as an integer (1-5)
                
                if (currentIndex + 1 < questions.length) {
                    botResponse = `Thank you! Next question:\n${currentIndex + 2}. ${questions[currentIndex + 1]}`;
                    req.session.currentQuestionIndex++;
                } else {
                    const { weightedScores, result } = await chatbotController.calculateWeightedScores(req.session.answers, req.session.selectedPosition, questions);
                    console.log("Scores:", weightedScores);
    
                    if (result === 'pass') {
                        botResponse = "Congratulations! You passed the screening.";
                    } else {
                        botResponse = "Sorry, you didn’t meet the required score.";
                    }
                    applicantStage = 'application_complete';
                }
            } else {
                botResponse = 'Here are our current job openings:\n' + positions.map(pos => `- ${pos}`).join('\n') + '\nPlease select a position.';
                applicantStage = 'job_selection';

                console.log('Bot Response:', botResponse);
                console.log('Final Applicant Stage:', applicantStage);
            }
    
            // Log every interaction (both user message and bot response)
            // const { data: interactionData, error: interactionError } = await supabase
            //     .from('chatbot_interaction')
            //     .insert([{
            //         userId: userId,
            //         message: userMessage,
            //         response: botResponse,
            //         timestamp: timestamp,
            //         applicantStage: applicantStage,
            //     }])
            //     .select('chatId')
            //     .single();
    
            // if (interactionError) {
            //     console.error('Error saving interaction to Supabase:', interactionError);
            // }
    
            res.json({ response: botResponse });
        } catch (error) {
            console.error('Error processing chatbot message:', error);
            res.status(500).json({ response: 'Sorry, I am having trouble understanding that.' });
        }
    },    
    
// Function to get screening questions
getInitialScreeningQuestions: async function (jobId) {
    try {
        // Fetch job position details
        const jobPositionQuery = await supabase
            .from('jobpositions')
            .select('jobType, jobTimeCommitment, jobTimeCommitment_startTime, jobTimeCommitment_endTime')
            .eq('jobId', jobId);

        // Fetch related job requirements
        const degreesQuery = await supabase
            .from('jobreqdegrees')
            .select('jobReqDegreeType, jobReqDegreeDescrpt')
            .eq('jobId', jobId);

        const experiencesQuery = await supabase
            .from('jobreqexperiences')
            .select('jobReqExperienceType, jobReqExperienceDescrpt')
            .eq('jobId', jobId);

        const certificationsQuery = await supabase
            .from('jobreqcertifications')
            .select('jobReqCertificateType, jobReqCertificateDescrpt')
            .eq('jobId', jobId);

        const hardSkillsQuery = await supabase
            .from('jobreqskills')
            .select('jobReqSkillType, jobReqSkillName')
            .eq('jobId', jobId)
            .eq('jobReqSkillType', 'Hard Skills');

        const softSkillsQuery = await supabase
            .from('jobreqskills')
            .select('jobReqSkillType, jobReqSkillName')
            .eq('jobId', jobId)
            .eq('jobReqSkillType', 'Soft Skills');

        // Check for errors
        if (
            jobPositionQuery.error ||
            degreesQuery.error ||
            experiencesQuery.error ||
            certificationsQuery.error ||
            hardSkillsQuery.error ||
            softSkillsQuery.error
        ) {
            console.error("Error fetching data:", {
                jobPositionError: jobPositionQuery.error,
                degreesError: degreesQuery.error,
                experiencesError: experiencesQuery.error,
                certificationsError: certificationsQuery.error,
                hardSkillsError: hardSkillsQuery.error,
                softSkillsError: softSkillsQuery.error,
            });
            return [];
        }

        // Extract job position details
        const jobPosition = jobPositionQuery.data[0] || {};

        // Combine and structure screening questions
        const questions = [
            ...degreesQuery.data.map(d => ({
                type: 'degree',
                question: `Do you have a degree related to ${d.jobReqDegreeType}: ${d.jobReqDegreeDescrpt}?`,
            })),
            ...experiencesQuery.data.map(e => ({
                type: 'experience',
                question: `When it comes to experience, do you qualify (${e.jobReqExperienceType}: ${e.jobReqExperienceDescrpt})?`,
            })),
            ...certificationsQuery.data.map(c => ({
                type: 'certification',
                question: `When it comes to certifications, have you earned (${c.jobReqCertificateType}: ${c.jobReqCertificateDescrpt})?`,
            })),
            ...hardSkillsQuery.data.map(s => ({
                type: 'hard_skill',
                question: `To assess your hard skills, please answer the following question: Do you have ${s.jobReqSkillName}?`,
            })),
            ...softSkillsQuery.data.map(s => ({
                type: 'soft_skill',
                question: `To assess your soft skills, please answer the following question: Do you have ${s.jobReqSkillName}?`,
            })),
            {
                type: 'work_setup',
                question: `With regards to the work setup, are you comfortable working ${jobPosition.jobType || 'the specified type'}?`,
            },
            {
                type: 'availability',
                question: `With regards to your availability, are you amenable to working ${jobPosition.jobTimeCommitment || 'the specified hours'} from ${jobPosition.jobTimeCommitment_startTime || 'N/A'} AM to ${jobPosition.jobTimeCommitment_endTime || 'N/A'} PM?`,
            },
        ];

        console.log("Structured Screening Questions:", questions);

        if (questions.length === 0) {
            console.log("No screening questions found for job ID:", jobId);
        }

        return questions;
    } catch (error) {
        console.error("An error occurred while fetching screening questions:", error);
        return [];
    }
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
// Function to fetch detailed job information, including required certifications, degrees, experiences, and skills
getJobDetails: async function(jobTitle) {
    try {
        const { data: jobDetails, error } = await supabase
            .from('jobpositions')
            .select(`
                jobId, jobTitle, jobDescrpt,
                jobreqcertifications(jobReqCertificateType, jobReqCertificateDescrpt),
                jobreqdegrees(jobReqDegreeType, jobReqDegreeDescrpt),
                jobreqexperiences(jobReqExperienceType, jobReqExperienceDescrpt),
                jobreqskills(jobReqSkillType, jobReqSkillName)
            `)
            .eq('jobTitle', jobTitle)
            .single();

        if (error) {
            console.error('Error fetching job details:', error);
            return null;
        }

        return jobDetails;
    } catch (error) {
        console.error('Server error:', error);
        return null;
    }
},

    // Calculate weighted scores based on answers
    calculateWeightedScores: async function (answers, selectedPosition, questions) {
        try {
            const scores = {
                degreeScore: 0,
                experienceScore: 0,
                certificationScore: 0,
                hardSkillsScore: 0,
                softSkillsScore: 0,
                totalScore: 0
            };
    
            for (let i = 0; i < answers.length; i++) {
                const question = questions[i].toLowerCase();
                if (question.includes('degree')) scores.degreeScore += answers[i];
                else if (question.includes('experience')) scores.experienceScore += answers[i];
                else if (question.includes('certifications')) scores.certificationScore += answers[i];
                else if (question.includes('hard skills')) scores.hardSkillsScore += answers[i];
                else if (question.includes('soft skills')) scores.softSkillsScore += answers[i];
            }
    
            const totalScore = scores.degreeScore + scores.experienceScore +
                scores.certificationScore + scores.hardSkillsScore + scores.softSkillsScore;
            scores.totalScore = totalScore;
    
            const result = totalScore >= 15 ? 'pass' : 'fail';
    
            return { weightedScores: scores, result };
        } catch (error) {
            console.error("Error calculating scores:", error);
            return { weightedScores: {}, result: 'fail' };
        }
    },
    

    // Function to calculate weighted scores for screening answers
    // calculateWeightedScores: async function(answers, selectedPosition, screeningQuestions) {
    //     if (!screeningQuestions || screeningQuestions.length === 0) {
    //         return { weightedScores: [], result: 'fail' };
    //     }
    
    //     const jobDetails = await chatbotController.getJobDetails(selectedPosition);
    
    //     const weightings = {
    //         degreeRelevance: 1.5,  // Degree-related questions are weighted higher
    //         softSkills: 1,         // Soft skills-related questions have a standard weight
    //     };
    
    //     let totalScore = 0;
    //     const weightedScores = answers.map((answer, index) => {
    //         const question = screeningQuestions[index];
    //         let weight = 1; // Default weight
    
    //         if (question.toLowerCase().includes('degree required')) {
    //             weight = weightings.degreeRelevance;  
    //         } else if (question.toLowerCase().includes('experience') || question.toLowerCase().includes('skill')) {
    //             weight = weightings.softSkills;  
    //         }
    
    //         const weightedScore = answer * weight;
    //         totalScore += weightedScore;
    
    //         return weightedScore;
    //     });
    
    //     // Calculate average score and determine pass/fail
    //     const averageScore = totalScore / screeningQuestions.length;
    //     const result = averageScore >= 3 ? 'pass' : 'fail';  // Assume a threshold of 3 to pass
    
    //     return { weightedScores, result };
    // },    

    
// File upload handler in your controller
handleFileUpload: async function(req, res) {
    try {
        // Check if file is uploaded
        if (!req.files || !req.files.file) {
            return res.status(400).send('No file uploaded.');
        }

        const file = req.files.file;
        
        // Check if user is authenticated, if not, use 'anonymous'
        const userId = req.body.userId || 'anonymous'; // If userId is not provided, mark as 'anonymous'

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
        
        // Insert file metadata into the database (optional)
        const { data: insertedFile, error: insertError } = await supabase
            .from('user_files') // Your table for storing file metadata
            .insert([{
                userId: userId,     // User who uploaded the file (anonymous or authenticated)
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
