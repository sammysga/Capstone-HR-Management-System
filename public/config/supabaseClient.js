const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://amzzxgaqoygdgkienkwf.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFtenp4Z2Fxb3lnZGdraWVua3dmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MjQzMjk0MzUsImV4cCI6MjAzOTkwNTQzNX0.1GdKI-d9CnJoLn0-T_VdM2Pd75PVHzAYOPIg_f7sgDQ'


const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;