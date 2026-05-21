#!/bin/bash
# Development environment setup script

set -e

echo "🔧 Setting up Home Assistant Device Manager development environment..."

# Check if Python 3.11+ is available
if ! python3 -c "import sys; exit(0 if sys.version_info >= (3,11) else 1)" 2>/dev/null; then
    echo "❌ Python 3.11 or higher is required"
    exit 1
fi

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "🚀 Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo "⬆️ Upgrading pip..."
pip install --upgrade pip

# Install development dependencies
echo "📚 Installing development dependencies..."
pip install -e ".[dev]"

# Install pre-commit hooks
echo "🪝 Installing pre-commit hooks..."
pre-commit install

# Frontend setup
if [ -d "custom_components/device_manager/frontend" ]; then
    echo "🎨 Setting up frontend..."
    cd custom_components/device_manager/frontend

    # Check if Node.js is available
    if command -v node >/dev/null 2>&1; then
        echo "📦 Installing Node.js dependencies..."
        npm install
        echo "🏗️ Building frontend..."
        npm run build
    else
        echo "⚠️ Node.js not found. Frontend build skipped."
        echo "   Install Node.js 18+ to build the frontend components."
    fi

    cd - > /dev/null
fi

echo ""
echo "✅ Development environment setup complete!"
echo ""
echo "🎯 Next steps:"
echo "  1. Activate the environment: source venv/bin/activate"
echo "  2. Run tests: pytest"
echo "  3. Start development: follow README.md instructions"
echo ""
