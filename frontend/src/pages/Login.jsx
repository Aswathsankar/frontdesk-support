import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Paper, TextField, Button, Typography, Alert, CircularProgress, Divider } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useFormik } from 'formik';
import * as Yup from 'yup';
import { agentApi } from '../api/agentApi.js';
import { useAuth } from '../App.jsx';

const schema = Yup.object({
  email: Yup.string().email('Invalid email').required('Required'),
  password: Yup.string().required('Required'),
});

export default function Login() {
  const { setAgent } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  const formik = useFormik({
    initialValues: { email: '', password: '' },
    validationSchema: schema,
    onSubmit: async (values, { setSubmitting }) => {
      setError('');
      try {
        const { data } = await agentApi.post('/auth/login', values);
        setAgent(data);
        navigate('/');
      } catch (err) {
        setError(err.response?.data?.error || 'Login failed');
      } finally {
        setSubmitting(false);
      }
    },
  });

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
      }}
    >
      <Paper
        elevation={0}
        sx={{
          p: 5, width: '100%', maxWidth: 420,
          border: '1px solid rgba(99,102,241,0.3)',
          boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
          backdropFilter: 'blur(10px)',
          background: 'rgba(30,41,59,0.9)',
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 4 }}>
          <Box sx={{
            width: 56, height: 56, borderRadius: 2,
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 2,
            boxShadow: '0 8px 20px rgba(99,102,241,0.4)',
          }}>
            <LockOutlinedIcon sx={{ color: 'white', fontSize: 28 }} />
          </Box>
          <Typography variant="h5" sx={{ color: '#f1f5f9', fontWeight: 700 }}>Frontdesk</Typography>
          <Typography variant="body2" sx={{ color: '#94a3b8', mt: 0.5 }}>Agent Portal — Sign in to continue</Typography>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

        <form onSubmit={formik.handleSubmit} id="agent-login-form">
          <TextField
            id="email"
            name="email"
            label="Email address"
            fullWidth
            margin="normal"
            value={formik.values.email}
            onChange={formik.handleChange}
            onBlur={formik.handleBlur}
            error={formik.touched.email && Boolean(formik.errors.email)}
            helperText={formik.touched.email && formik.errors.email}
            autoComplete="email"
            autoFocus
          />
          <TextField
            id="password"
            name="password"
            label="Password"
            type="password"
            fullWidth
            margin="normal"
            value={formik.values.password}
            onChange={formik.handleChange}
            onBlur={formik.handleBlur}
            error={formik.touched.password && Boolean(formik.errors.password)}
            helperText={formik.touched.password && formik.errors.password}
            autoComplete="current-password"
          />
          <Button
            type="submit"
            variant="contained"
            fullWidth
            size="large"
            id="login-submit-btn"
            disabled={formik.isSubmitting}
            sx={{
              mt: 3, py: 1.5,
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              boxShadow: '0 4px 15px rgba(99,102,241,0.4)',
              '&:hover': { background: 'linear-gradient(135deg, #5558e3, #7c3aed)' },
            }}
          >
            {formik.isSubmitting ? <CircularProgress size={22} color="inherit" /> : 'Sign In'}
          </Button>
        </form>

        <Divider sx={{ my: 3, borderColor: 'rgba(99,102,241,0.2)' }} />
        <Typography variant="body2" sx={{ color: '#94a3b8', textAlign: 'center' }}>
          Not an agent?{' '}
          <a href="/customer" style={{ color: '#6366f1', textDecoration: 'none', fontWeight: 600 }}>
            Customer portal →
          </a>
        </Typography>
        <Typography variant="caption" sx={{ color: '#475569', display: 'block', textAlign: 'center', mt: 2 }}>
          Demo: aswath@arvo.dev / Demo@1234
        </Typography>
        <Typography variant="caption" sx={{ color: '#334155', display: 'block', textAlign: 'center', mt: 1 }}>
          Built by Aswath Menon · Coligo Assessment
        </Typography>
      </Paper>
    </Box>
  );
}
